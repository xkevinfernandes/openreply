// When each broadcast message goes out. Pure: the clock and the randomness are
// passed in. Human pacing (spec, Broadcast: Follow-up Friday):
//  - inside the window (e.g. Fri 10:00–15:00, workspace timezone)
//  - spread over it with normal jitter around evenly spaced slots
//  - never on the minute: no :00 minute, no :00 second
//  - a minimum gap between two sends
//  - a message must go before that person's 24h window closes
//  - the daily send cap: whatever would pass it is held back, never sent

import { localDate, tzOffsetMs } from "@/lib/os/sending/cap";

const MIN = 60_000;
const DAY = 86_400_000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Default smallest gap between two sends. Shrinks when the window is tight. */
export const MIN_GAP_MS = 4 * MIN;

export type Rng = () => number;

/** Seeded uniform [0,1) (mulberry32): the same seed gives the same plan. */
export function seededRng(seed: number | string): Rng {
  let a = typeof seed === "number" ? seed >>> 0 : [...seed].reduce((h, c) => (Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0), 2166136261);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal from a uniform source (Box–Muller). */
export function normal(rng: Rng): number {
  let u = 0;
  while (u === 0) u = rng();
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function hm(s: string): [number, number] {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return [NaN, NaN];
  return [Number(m[1]), Number(m[2])];
}

export function validTime(s: string): boolean {
  const [h, m] = hm(s);
  return Number.isInteger(h) && Number.isInteger(m) && h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** The UTC instant of local "YYYY-MM-DD HH:MM" in `tz`. DST-safe. */
export function zonedInstant(date: string, time: string, tz: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hm(time);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  let guess = asUtc - tzOffsetMs(new Date(asUtc), tz);
  guess = asUtc - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** The window of a run day as UTC instants. */
export function windowBounds(runDate: string, start: string, end: string, tz: string): { start: Date; end: Date } {
  return { start: zonedInstant(runDate, start, tz), end: zonedInstant(runDate, end, tz) };
}

/** Next run date ("YYYY-MM-DD", in tz) of a weekly window. Today counts until the window ends. */
export function nextRunDate(windowDay: number, windowEnd: string, tz: string, now: Date): { date: string; today: boolean } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const dow = DOW.indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const [eh, em] = hm(windowEnd);
  let ahead = (windowDay - dow + 7) % 7;
  if (ahead === 0 && minutes >= eh * 60 + (em || 0)) ahead = 7;
  return { date: localDate(new Date(now.getTime() + ahead * DAY), tz), today: ahead === 0 };
}

/** Minute and second of an instant in tz. */
function localClock(ms: number, tz: string): { minute: number; second: number } {
  const local = new Date(ms + tzOffsetMs(new Date(ms), tz));
  return { minute: local.getUTCMinutes(), second: local.getUTCSeconds() };
}

/** True when the time would read as typed: :00 minute or :00 second. */
export function onTheMinute(ms: number, tz: string): boolean {
  const c = localClock(ms, tz);
  return c.minute === 0 || c.second === 0;
}

/** Move a time forward, a little, off :00 minutes and :00 seconds. Never backward. */
export function humanise(ms: number, tz: string, rng: Rng): number {
  let t = Math.ceil(ms / 1000) * 1000;
  if (localClock(t, tz).minute === 0) t += (1 + Math.floor(rng() * 4)) * MIN;
  const sec = localClock(t, tz).second;
  let delta = 1 + Math.floor(rng() * 59) - sec;
  if (delta < 0) delta += 60;
  t += delta * 1000;
  if (localClock(t, tz).second === 0) t += 1000;
  if (localClock(t, tz).minute === 0) t += MIN;
  return t;
}

/** Room kept before the window end: humanise moves a time forward up to ~6 min. */
const END_ROOM = 7 * MIN;

/**
 * n send times inside [start, end): evenly spaced slots, each moved by normal
 * jitter (sd = a quarter slot), at least the gap apart, never on the minute.
 * Sorted ascending.
 */
export function planTimes(n: number, start: Date, end: Date, tz: string, rng: Rng, minGapMs = MIN_GAP_MS): number[] {
  if (n <= 0) return [];
  const lo = start.getTime() + MIN;
  const hi = Math.max(lo + MIN, end.getTime() - END_ROOM);
  const span = hi - lo;
  const slot = span / n;
  const gap = Math.min(minGapMs, slot * 0.8);
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = lo + slot * (i + 0.5) + normal(rng) * slot * 0.25;
    raw.push(Math.min(hi, Math.max(lo, t)));
  }
  raw.sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const want = i ? Math.max(raw[i], out[i - 1] + gap) : raw[i];
    out.push(humanise(want, tz, rng));
  }
  // A very tight window: pull the tail back inside (the gap gives way, the minute rule doesn't).
  const last = end.getTime() - 61_000;
  return out.map((t) => {
    if (t <= last) return t;
    let c = last;
    while (onTheMinute(c, tz)) c -= 1000;
    return c;
  });
}

/** When the follow-up goes: "3–8 min later" around 5, or about an hour. */
export function followupDelayMs(delayMin: number, rng: Rng): number {
  if (delayMin >= 30) return Math.round((delayMin - 5 + rng() * 15) * MIN + rng() * 59_000);
  const lo = Math.max(1, delayMin - 2);
  const hi = delayMin + 3;
  const mean = (lo + hi) / 2;
  const v = Math.min(hi, Math.max(lo, mean + normal(rng) * ((hi - lo) / 4)));
  return Math.round(v * MIN + 1000 + rng() * 58_000);
}

export interface ScheduleItem {
  id: string;
  /** Bubbles this message sends, follow-up included (each counts toward the cap). */
  bubbles: number;
  /** Their 24h window closes at; null = open all window. */
  deadline: number | null;
}

export type ScheduleOutcome =
  | { id: string; status: "scheduled"; at: number }
  | { id: string; status: "outside_window"; reason: string }
  | { id: string; status: "capped"; reason: string };

/**
 * Give each message a time. Earliest deadline gets the earliest slot, so
 * someone whose window closes at 11:00 goes first. A message whose slot
 * would come after its deadline is outside the window. Bubbles are added up
 * in send order; what would pass `capLeft` is held back ("capped").
 */
export function assignSchedule(
  items: ScheduleItem[],
  opts: { start: Date; end: Date; tz: string; rng: Rng; capLeft: number; now?: Date; minGapMs?: number }
): ScheduleOutcome[] {
  const from = new Date(Math.max(opts.start.getTime(), (opts.now?.getTime() ?? 0) + MIN));
  if (from.getTime() >= opts.end.getTime()) {
    return items.map((i) => ({ id: i.id, status: "outside_window" as const, reason: "The window is over." }));
  }
  const live = items.filter((i) => i.deadline === null || i.deadline > from.getTime());
  const gone = items.filter((i) => !live.includes(i));
  const times = planTimes(live.length, from, opts.end, opts.tz, opts.rng, opts.minGapMs);
  const gap = opts.minGapMs ?? MIN_GAP_MS;
  const order = [...live].sort((a, b) => (a.deadline ?? Infinity) - (b.deadline ?? Infinity));
  const out: ScheduleOutcome[] = gone.map((i) => ({ id: i.id, status: "outside_window", reason: "Their 24h window closes before the send." }));

  // Earliest deadline takes the earliest slot. A slot past someone's deadline
  // is swapped for a fresh time before it (kept clear of the others).
  const placed: { item: ScheduleItem; at: number }[] = [];
  const free = [...times];
  for (const item of order) {
    let at = free.shift();
    if (at !== undefined && item.deadline !== null && at >= item.deadline) {
      const room = item.deadline - from.getTime() - 3 * MIN;
      let pick: number | null = null;
      for (let k = 0; k < 24 && room > 0 && pick === null; k++) {
        const t = humanise(from.getTime() + MIN + opts.rng() * room, opts.tz, opts.rng);
        const clear = placed.every((p) => Math.abs(p.at - t) >= Math.min(gap, room / Math.max(1, placed.length + 1)));
        if (t < item.deadline && clear) pick = t;
      }
      if (pick !== null) {
        free.unshift(at); // the slot stays for someone else
        at = pick;
      } else at = undefined;
    }
    if (at === undefined) {
      out.push({ id: item.id, status: "outside_window", reason: "Their 24h window closes before the send." });
      continue;
    }
    placed.push({ item, at });
  }

  // The cap counts bubbles in send order.
  let used = 0;
  for (const p of placed.sort((a, b) => a.at - b.at)) {
    if (used + p.item.bubbles > opts.capLeft) {
      out.push({ id: p.item.id, status: "capped", reason: "Over the daily send cap." });
      continue;
    }
    used += p.item.bubbles;
    out.push({ id: p.item.id, status: "scheduled", at: p.at });
  }
  return out;
}

/** Percent position of each time across the window (the pacing strip). */
export function tickPercents(times: number[], start: Date, end: Date): number[] {
  const span = end.getTime() - start.getTime();
  if (span <= 0) return [];
  return times.map((t) => Math.round(((t - start.getTime()) / span) * 10000) / 100).filter((p) => p >= 0 && p <= 100);
}

/** Hour labels for the strip: start, each full hour, end. */
export function hourLabels(start: string, end: string): string[] {
  const [sh, sm] = hm(start);
  const [eh, em] = hm(end);
  const out = [start];
  for (let h = sh + 1; h < eh || (h === eh && em > 0); h++) out.push(`${String(h).padStart(2, "0")}:00`);
  void sm;
  if (out[out.length - 1] !== end) out.push(end);
  return out;
}
