// One-off broadcast rules, pure (dm-crm slice 5): links and the link guard,
// Start (Now's end time, Window), Duplicate's next date, the cap figures in
// planned messages, and the status a run gives. The clock is passed in.

import { localDate, tzOffsetMs } from "@/lib/os/sending/cap";
import { MIN_GAP_MS, nextRunDate, validTime, zonedInstant } from "@/lib/os/broadcasts/schedule";
import { firstNameOf } from "@/lib/os/broadcasts/template";
import type { BroadcastBubble, BroadcastMessageView, BroadcastRunStatus, BroadcastStatus, BroadcastView, SkipReason } from "@/lib/os/broadcasts/types";

const MIN = 60_000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const URL_RE = /https?:\/\/[^\s<>"']+|\bwww\.[^\s<>"']+/gi;

// ---------------------------------------------------------------- links

/** Query params that only track a click, dropped before comparing links. */
const TRACKING = /^(utm_.*|fbclid|gclid|dclid|msclkid|igshid|igsh|mc_cid|mc_eid|_hsenc|_hsmi|mkt_tok|ref_src|si|ck_subscriber_id)$/i;

/** A link for comparing: lower-case host, no www., no trailing slash, no
 *  tracking params, no hash. Null when it isn't a link. */
export function normaliseLink(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!u.hostname.includes(".")) return null;
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
    const q = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    const path = u.pathname.replace(/\/+$/, "");
    return `${host}${u.port ? `:${u.port}` : ""}${path}${q}`;
  } catch {
    return null;
  }
}

/** Every link in some text bubbles, normalised. */
export function linksIn(texts: string[]): string[] {
  const out = new Set<string>();
  for (const t of texts) for (const m of t.match(URL_RE) ?? []) {
    const n = normaliseLink(m.replace(/[),.!?]+$/, ""));
    if (n) out.add(n);
  }
  return [...out];
}

/** The broadcast's own links (its link bubbles), normalised. */
export function bubbleLinks(bubbles: BroadcastBubble[]): string[] {
  return [...new Set(bubbles.flatMap((b) => (b.type === "link" && b.url ? [normaliseLink(b.url)] : [])).filter((x): x is string => !!x))];
}

/** A link bubble still waiting for a resource or a link. */
export function hasEmptyLink(bubbles: BroadcastBubble[]): boolean {
  return bubbles.some((b) => b.type === "link" && !b.url);
}

/**
 * The link guard: who was already sent one of these links in an earlier
 * broadcast (sent messages, plus links Kevin sent himself from Review).
 * Returns contactId → the earliest such send (ISO, or "" when unknown).
 */
export function alreadyHadLink(links: string[], traces: { contactId: string; bubbles: string[]; sentLinks: string[]; at: string | null }[]): Map<string, string> {
  const want = new Set(links);
  const out = new Map<string, string>();
  if (!want.size) return out;
  for (const t of traces) {
    const theirs = [...linksIn(t.bubbles), ...t.sentLinks.map(normaliseLink).filter((x): x is string => !!x)];
    if (!theirs.some((l) => want.has(l))) continue;
    const prev = out.get(t.contactId);
    if (prev === undefined || (t.at && (!prev || t.at < prev))) out.set(t.contactId, t.at ?? prev ?? "");
  }
  return out;
}

// ---------------------------------------------------------------- the message

/** A person's bubbles from the broadcast's: {first_name} filled, links as they are, each its own bubble. */
export function asWritten(bubbles: BroadcastBubble[], c: { fullName: string | null; username: string | null }): string[] {
  const first = firstNameOf(c.fullName, c.username);
  return bubbles.flatMap((b) => {
    if (b.type === "link") return b.url ? [b.url] : [];
    const t = b.text.replace(/\{first_name\}/gi, first).trim();
    return t ? [t] : [];
  });
}

/** The text bubbles of the broadcast (what J rewrites). */
export function textOf(bubbles: BroadcastBubble[]): string[] {
  return bubbles.flatMap((b) => (b.type === "text" && b.text.trim() ? [b.text.trim()] : []));
}

/** The link bubbles' urls, in order. */
export function linksOf(bubbles: BroadcastBubble[]): string[] {
  return bubbles.flatMap((b) => (b.type === "link" && b.url ? [b.url] : []));
}

/**
 * One variation into the broadcast's shape: its lines take the text bubbles'
 * places when the count matches (links stay where Kevin put them), else the
 * text goes first and the links after. {first_name} filled.
 */
export function fromVariation(bubbles: BroadcastBubble[], variation: string[], c: { fullName: string | null; username: string | null }): string[] {
  const first = firstNameOf(c.fullName, c.username);
  const fill = (t: string) => t.replace(/\{first_name\}/gi, first).trim();
  const texts = textOf(bubbles);
  const lines = variation.map(fill).filter(Boolean);
  if (lines.length === texts.length) {
    let i = 0;
    return bubbles.flatMap((b) => (b.type === "link" ? (b.url ? [b.url] : []) : b.text.trim() ? [lines[i++]] : []));
  }
  return [...lines, ...linksOf(bubbles)];
}

/** Spread people evenly at random over n variations: index per person. */
export function spreadEvenly(ids: string[], n: number, rng: () => number): Map<string, number> {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const offset = Math.floor(rng() * Math.max(1, n));
  return new Map(order.map((id, i) => [id, (i + offset) % Math.max(1, n)]));
}

/** Messages per person: bubbles plus the follow-up's. */
export function plannedOf(m: Pick<BroadcastMessageView, "bubbles" | "followupBubbles">): number {
  return m.bubbles.length + m.followupBubbles.length;
}

/** "3 messages per person" from the broadcast itself (follow-up included). */
export function perPerson(b: Pick<BroadcastView, "bubbles" | "followupTemplate">): number {
  return b.bubbles.filter((x) => x.type === "link" || x.text.trim()).length + (b.followupTemplate?.trim() ? 1 : 0);
}

// ---------------------------------------------------------------- Start

function localHm(now: Date, tz: string): number {
  const local = new Date(now.getTime() + tzOffsetMs(now, tz));
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

/** Now's default end time: 15:00, or two hours from now once that's passed; never past midnight. */
export function defaultNowEnd(now: Date, tz: string): string {
  const at = localHm(now, tz);
  if (at < 15 * 60) return "15:00";
  const two = Math.ceil((at + 120) / 5) * 5;
  return fmt(Math.min(two, 23 * 60 + 59));
}

/** Is Now's end time still ahead today? (A past or not-after-now end is refused.) */
export function nowEndError(end: string, now: Date, tz: string): string | null {
  if (!validTime(end)) return "End time looks wrong (HH:MM).";
  if (toMin(end) <= localHm(now, tz)) return "Pick an end time later than now.";
  return null;
}

/** Window's error, if any: a real date, start before end, end not passed. */
export function windowError(date: string | null, start: string, end: string, now: Date, tz: string): string | null {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "Pick a date.";
  if (!validTime(start) || !validTime(end)) return "Times look wrong (HH:MM).";
  if (start >= end) return "The window has to end after it starts.";
  if (zonedInstant(date, end, tz).getTime() <= now.getTime()) return "That window has already ended.";
  return null;
}

/** "Fri 30 Oct, 10:00–15:00" (window) or "Now · until 15:00". */
export function startLabel(b: Pick<BroadcastView, "startMode" | "sendDate" | "windowStart" | "windowEnd" | "timezone">): string {
  if (b.startMode === "now") return b.sendDate ? `${dayLabel(b.sendDate, b.timezone)} · until ${b.windowEnd}` : `Now · until ${b.windowEnd}`;
  if (!b.sendDate) return "No date yet";
  return `${dayLabel(b.sendDate, b.timezone)}, ${b.windowStart}–${b.windowEnd}`;
}

/** "Fri 30 Oct" */
export function dayLabel(date: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: tz }).format(zonedInstant(date, "12:00", tz)).replace(",", "");
}

/** The weekday (0 = Sunday) of "YYYY-MM-DD". */
export function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay();
}

/** Duplicate's date: the next occurrence of the original's weekday (in its
 *  timezone), counting today unless today's window end has passed. */
export function duplicateDate(original: Pick<BroadcastView, "sendDate" | "windowEnd" | "timezone">, now: Date): string | null {
  if (!original.sendDate) return null;
  return nextRunDate(weekdayOf(original.sendDate), original.windowEnd, original.timezone, now).date;
}

/** "Follow-up Friday · 24 Oct" → "Follow-up Friday · 31 Oct". */
export function datedName(name: string, date: string | null, tz: string): string {
  const base = name.replace(/\s*·\s*\d{1,2} [A-Z][a-z]{2}$/, "").replace(/\s*\(copy\)$/, "").trim() || "Broadcast";
  if (!date) return base;
  const short = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: tz }).format(zonedInstant(date, "12:00", tz));
  return `${base} · ${short}`;
}

/** A URL slug for a name, unique against `taken`. */
export function slugFor(name: string, taken: (key: string) => boolean): string {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "broadcast";
  if (!taken(base)) return base;
  for (let i = 2; ; i++) if (!taken(`${base}-${i}`)) return `${base}-${i}`;
}

/** Today's local date and the window a Send uses. Now: from now until the end today. */
export function sendWindow(b: Pick<BroadcastView, "startMode" | "sendDate" | "windowStart" | "windowEnd" | "timezone">, now: Date): { date: string; start: Date; end: Date; today: boolean } {
  const today = localDate(now, b.timezone);
  if (b.startMode === "now") return { date: today, start: now, end: zonedInstant(today, b.windowEnd, b.timezone), today: true };
  const date = b.sendDate ?? today;
  return { date, start: zonedInstant(date, b.windowStart, b.timezone), end: zonedInstant(date, b.windowEnd, b.timezone), today: date === today };
}

// ---------------------------------------------------------------- the cap

/** The latest Now may be extended to. */
export const EXTEND_LIMIT = "23:00";

export interface CapFigures {
  /** Messages planned: every approved person's bubbles, follow-ups included. */
  planned: number;
  /** Left today under the cap (or the whole cap on another day). */
  left: number;
  /** People: approved and how many fit under the cap and the pacing. */
  people: number;
  fit: number;
  /** The cap is full: Now can't send. */
  full: boolean;
  /** Window: planned passes that day's cap (a warning, not a block). */
  over: boolean;
  /** Now: a later end time that lets more fit (≤ 23:00), or null. */
  extendTo: string | null;
}

/**
 * The figures Review shows, all in planned messages. `perPersonPlanned` is
 * each approved person's planned count, in send order.
 */
export function capFigures(opts: {
  perPersonPlanned: number[];
  cap: { sentToday: number; cap: number };
  today: boolean;
  mode: "now" | "window";
  start: Date;
  end: Date;
  now: Date;
  tz: string;
}): CapFigures {
  const planned = opts.perPersonPlanned.reduce((a, b) => a + b, 0);
  const left = Math.max(0, opts.today ? opts.cap.cap - opts.cap.sentToday : opts.cap.cap);
  let used = 0;
  let byCap = 0;
  for (const n of opts.perPersonPlanned) {
    if (used + n > left) break;
    used += n;
    byCap++;
  }
  const from = Math.max(opts.start.getTime(), opts.now.getTime() + MIN);
  const span = opts.end.getTime() - from - 7 * MIN;
  const byPace = span <= 0 ? 0 : Math.floor(span / MIN_GAP_MS) + 1;
  const people = opts.perPersonPlanned.length;
  const fit = Math.min(people, byCap, byPace);
  let extendTo: string | null = null;
  if (opts.mode === "now" && byPace < Math.min(people, byCap)) {
    const need = from + (Math.min(people, byCap) - 1) * MIN_GAP_MS + 8 * MIN;
    const local = new Date(need + tzOffsetMs(new Date(need), opts.tz));
    const mins = Math.min(toMin(EXTEND_LIMIT), Math.ceil((local.getUTCHours() * 60 + local.getUTCMinutes()) / 15) * 15);
    const endMins = (() => {
      const l = new Date(opts.end.getTime() + tzOffsetMs(opts.end, opts.tz));
      return l.getUTCHours() * 60 + l.getUTCMinutes();
    })();
    if (mins > endMins) extendTo = fmt(mins);
  }
  return { planned, left, people, fit, full: left <= 0, over: planned > left, extendTo };
}

// ---------------------------------------------------------------- status

/** The status table: what a run says about its broadcast. */
export function statusFromRun(run: { status: BroadcastRunStatus } | null, messages: Pick<BroadcastMessageView, "status">[]): BroadcastStatus {
  if (!run) return "draft";
  if (run.status === "drafting") return "drafting";
  if (run.status === "review") return "in_review";
  if (run.status === "scheduled") return messages.some((m) => m.status === "sent") ? "sending" : "scheduled";
  return "sent";
}

/** Kevin's words for a skip reason code written by older code paths. */
export function skipReasonOf(error: string | null | undefined): SkipReason | null {
  const e = (error ?? "").toLowerCase();
  if (!e) return null;
  if (e.includes("cap")) return "cap";
  if (e.includes("window is over") || e.includes("whole window")) return "window_end";
  if (e.includes("24h") || e.includes("24-hour") || e.includes("window")) return "their_window";
  if (e.includes("left the audience") || e.includes("left the tag")) return "left_the_tag";
  return null;
}

export const DOW_SHORT = DOW;
