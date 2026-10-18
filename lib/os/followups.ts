// The Follow-ups queue (spec: one queue, J's nudges V1-3 + Friday resource
// sends LF-6). Pure: no IO, no clock. lib/os/followups-data.ts loads the rows
// and the page renders what these functions return.
//
// Nudges: contacts whose next J action is a nudge or a value opener that is
// due (or due within SOON_HOURS), plus pending nudge / opener drafts.
// Friday: contacts flagged "Add to Friday", with the resource they haven't had
// yet. Port of DM Setter/scripts/dms/friday.py (candidates, pick_resource).

import { FREEZE_TAGS, parseIso, slugsWithTagPrefix, windowState, type SetterRecord, type StateConfig, type WindowState } from "@/lib/os/setter/state";

const HOUR = 3600_000;
const DAY = 24 * HOUR;

/** "Soon" = due within this many hours. */
export const SOON_HOURS = 24;
/** Nobody gets two Friday gifts within a week (friday.py). */
export const FRIDAY_GAP_DAYS = 7;
export const FRIDAY_TZ = "Europe/Luxembourg";
/** The line before the resource when you don't write one (friday.py's fallback). */
export const DEFAULT_FRIDAY_NOTE = "thought of you when I saw this, sharing in case it helps";

export type NudgeKind = "nudge" | "value_opener";
const NUDGE_KINDS: string[] = ["nudge", "value_opener"];
const STOP_TAGS = [...FREEZE_TAGS, "booked", "not_now"];
const STOP_STATES = ["frozen", "booked", "not_now"];

export interface QueueContact {
  contactId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  kind: "SALES" | "PERSONAL" | "UNSORTED";
  paused: boolean;
  tags: string[];
  /** SetterState columns (null when J never looked at them). */
  state: string | null;
  nextActionKind: string | null;
  nextActionAt: string | null;
  snoozedUntil: string | null;
  record: SetterRecord | null;
}

export interface QueueDraft {
  id: string;
  contactId: string;
  kind: string;
  bubbles: string[];
  flags: string[];
  setterStage: string | null;
  reasoning: string | null;
  humanAgent: boolean;
  createdAt: string;
}

export type NudgeStatus = "drafted" | "due" | "soon";

export interface NudgeItem {
  contactId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  kind: NudgeKind;
  status: NudgeStatus;
  /** When the timer is (or was) due. */
  at: string | null;
  window: WindowState;
  windowUntil: string | null;
  /** The timer anchor J uses (nudge:<our_last_at>, opener:<delivered_at>); Skip remembers it. */
  anchor: string | null;
  draft: QueueDraft | null;
}

function snoozed(c: QueueContact, now: Date): boolean {
  const until = parseIso(c.snoozedUntil);
  return Boolean(until && until > now);
}

/** The anchor advance() would give this timer. */
export function timerAnchor(kind: NudgeKind, rec: SetterRecord | null): string | null {
  if (!rec) return null;
  if (kind === "nudge") return rec.our_last_at ? `nudge:${rec.our_last_at}` : null;
  return rec.delivered_at ? `opener:${rec.delivered_at}` : null;
}

/** Why J shouldn't nudge them at all right now (null = fine). */
export function nudgeBlocked(c: QueueContact): string | null {
  if (c.kind !== "SALES") return "not sales";
  if (c.paused) return "paused";
  if (c.tags.some((t) => STOP_TAGS.includes(t))) return "tagged";
  if (c.state && STOP_STATES.includes(c.state)) return c.state;
  return null;
}

const STATUS_ORDER: Record<NudgeStatus, number> = { drafted: 0, due: 1, soon: 2 };

/** J's half of the queue. Drafted first, then due (oldest first), then soon. */
export function selectNudges(
  contacts: QueueContact[],
  drafts: QueueDraft[],
  now: Date,
  opts: { soonHours?: number; cfg?: StateConfig } = {}
): NudgeItem[] {
  const horizon = now.getTime() + (opts.soonHours ?? SOON_HOURS) * HOUR;
  const draftBy = new Map<string, QueueDraft>();
  for (const d of drafts) {
    const cur = draftBy.get(d.contactId);
    if (!cur || d.createdAt > cur.createdAt) draftBy.set(d.contactId, d);
  }

  const out: NudgeItem[] = [];
  for (const c of contacts) {
    if (snoozed(c, now)) continue;
    const rec = c.record;
    const [win, until] = windowState(rec?.their_last_at ?? null, now, opts.cfg);
    const base = {
      contactId: c.contactId,
      username: c.username,
      fullName: c.fullName,
      avatarUrl: c.avatarUrl,
      conversationId: c.conversationId,
      window: win,
      windowUntil: until,
    };
    const draft = draftBy.get(c.contactId) ?? null;

    if (draft) {
      // A reply or invitation waiting belongs to the Inbox, not here.
      if (!NUDGE_KINDS.includes(draft.kind)) continue;
      const kind = draft.kind as NudgeKind;
      out.push({ ...base, kind, status: "drafted", at: c.nextActionAt ?? draft.createdAt, anchor: timerAnchor(kind, rec), draft });
      continue;
    }

    if (!c.nextActionKind || !NUDGE_KINDS.includes(c.nextActionKind)) continue;
    const at = parseIso(c.nextActionAt);
    if (!at || at.getTime() > horizon) continue;
    if (nudgeBlocked(c)) continue;
    if (win === "closed") continue;
    const kind = c.nextActionKind as NudgeKind;
    const anchor = timerAnchor(kind, rec);
    if (anchor && (rec?.skipped_anchors ?? []).includes(anchor)) continue;
    out.push({ ...base, kind, status: at <= now ? "due" : "soon", at: c.nextActionAt, anchor, draft: null });
  }

  return out.sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (a.at ?? "").localeCompare(b.at ?? ""));
}

// ---------------------------------------------------------------- Friday

/** Calendar parts of `now` in a timezone. */
function zoned(now: Date, tz: string): { y: number; m: number; d: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { y: Number(get("year")), m: Number(get("month")), d: Number(get("day")), weekday };
}

export function isFriday(now: Date, tz = FRIDAY_TZ): boolean {
  return zoned(now, tz).weekday === 5;
}

/** "YYYY-MM-DD" of today when it is Friday, else the coming Friday. */
export function fridayFor(now: Date, tz = FRIDAY_TZ): string {
  const z = zoned(now, tz);
  const ahead = (5 - z.weekday + 7) % 7;
  const date = new Date(Date.UTC(z.y, z.m - 1, z.d + ahead));
  return date.toISOString().slice(0, 10);
}

export interface FridayResource {
  id: string;
  slug: string;
  name: string;
  link: string | null;
  status: "ACTIVE" | "TEST" | "DRAFT";
}

export interface FridaySendLog {
  contactId: string;
  resourceSlug: string;
  friday: string;
  status: string;
  sentAt: string | null;
}

export interface FridayContact {
  contactId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  tags: string[];
  state: string | null;
  record: SetterRecord | null;
  /** Fallback for their last message when J has no record (sample data). */
  theirLastAt?: string | null;
}

export type FridayStatus = "ready" | "sent" | "email_only" | "blocked" | "nothing_left";

export interface FridayItem {
  contactId: string;
  username: string | null;
  fullName: string | null;
  avatarUrl: string | null;
  conversationId: string | null;
  status: FridayStatus;
  /** Why it can't go out (blocked / email_only / nothing_left). */
  reason: string | null;
  /** "unknown" = J has no record of their last message; checked at send time. */
  window: WindowState | "unknown";
  windowUntil: string | null;
  /** Every resource slug they already had (thread, sent: tags, Friday log). */
  had: string[];
  /** The first active resource they haven't had. */
  suggested: string | null;
  /** What went out this Friday, if anything. */
  sent: { slug: string; at: string | null } | null;
}

/** Everything this person already got: never send the same one twice. */
export function resourcesHad(rec: SetterRecord | null, tags: string[], sends: FridaySendLog[]): string[] {
  const had = new Set<string>([...(rec?.resources_sent ?? []), ...slugsWithTagPrefix(tags, "sent:"), ...slugsWithTagPrefix(rec?.tags ?? [], "sent:")]);
  for (const s of sends) had.add(s.resourceSlug);
  return [...had].sort();
}

/** Resources a Friday send may use: active, with a link. */
export function sendableResources(resources: FridayResource[]): FridayResource[] {
  return resources.filter((r) => r.status === "ACTIVE" && Boolean(r.link));
}

/** friday.py pick_resource: the first sendable one they haven't had. */
export function pickResource(resources: FridayResource[], had: Iterable<string>): FridayResource | null {
  const seen = new Set(had);
  return sendableResources(resources).find((r) => !seen.has(r.slug)) ?? null;
}

const FRIDAY_ORDER: Record<FridayStatus, number> = { ready: 0, nothing_left: 1, email_only: 2, blocked: 3, sent: 4 };

export function selectFriday(
  contacts: FridayContact[],
  resources: FridayResource[],
  sends: FridaySendLog[],
  now: Date,
  opts: { friday?: string; cfg?: StateConfig; tz?: string } = {}
): FridayItem[] {
  const friday = opts.friday ?? fridayFor(now, opts.tz);
  const sendsBy = new Map<string, FridaySendLog[]>();
  for (const s of sends) sendsBy.set(s.contactId, [...(sendsBy.get(s.contactId) ?? []), s]);

  const items = contacts.map((c): FridayItem => {
    const mine = sendsBy.get(c.contactId) ?? [];
    const had = resourcesHad(c.record, c.tags, mine);
    const theirLast = c.record?.their_last_at ?? c.theirLastAt ?? null;
    const [win, until] = c.record || c.theirLastAt ? windowState(theirLast, now, opts.cfg) : (["unknown", null] as const);
    const suggested = pickResource(resources, had)?.slug ?? null;
    const thisWeek = mine.find((s) => s.friday === friday && s.status !== "sending");
    const base = {
      contactId: c.contactId,
      username: c.username,
      fullName: c.fullName,
      avatarUrl: c.avatarUrl,
      conversationId: c.conversationId,
      window: win,
      windowUntil: until,
      had,
      suggested,
    };
    if (thisWeek) return { ...base, status: "sent", reason: null, sent: { slug: thisWeek.resourceSlug, at: thisWeek.sentAt } };

    const tag = c.tags.find((t) => STOP_TAGS.includes(t));
    if (tag) return { ...base, status: "blocked", reason: `Tagged ${tag.replace("_", " ")}`, sent: null };
    if (c.state && STOP_STATES.includes(c.state)) return { ...base, status: "blocked", reason: `J has them as ${c.state.replace("_", " ")}`, sent: null };

    const lastGift = [parseIso(c.record?.friday_last_at), ...mine.map((s) => parseIso(s.sentAt))]
      .filter((d): d is Date => Boolean(d))
      .sort((a, b) => b.getTime() - a.getTime())[0];
    if (lastGift && now.getTime() - lastGift.getTime() < FRIDAY_GAP_DAYS * DAY) {
      const days = Math.max(1, Math.round((now.getTime() - lastGift.getTime()) / DAY));
      return { ...base, status: "blocked", reason: `Had a resource ${days} ${days === 1 ? "day" : "days"} ago`, sent: null };
    }
    if (win === "closed") return { ...base, status: "email_only", reason: "No DM window: they last wrote over 7 days ago", sent: null };
    if (!suggested) return { ...base, status: "nothing_left", reason: "They've had every active resource", sent: null };
    return { ...base, status: "ready", reason: null, sent: null };
  });

  return items.sort((a, b) => FRIDAY_ORDER[a.status] - FRIDAY_ORDER[b.status] || (a.username ?? "").localeCompare(b.username ?? ""));
}

/** Whether a Friday send of `slug` is allowed for this item (server re-checks). */
export function fridaySendProblem(item: Pick<FridayItem, "status" | "had" | "reason">, slug: string): string | null {
  if (item.status === "sent") return "Already sent this Friday.";
  if (item.status === "blocked" || item.status === "email_only") return item.reason ?? "Can't send to them.";
  if (item.had.includes(slug)) return "They already had that one.";
  return null;
}

/** Sidebar count: nudges ready or due now, plus (on Friday) the unsent list. */
export function dueCount(nudges: NudgeItem[], friday: FridayItem[], fridayToday: boolean): number {
  const n = nudges.filter((x) => x.status !== "soon").length;
  const f = fridayToday ? friday.filter((x) => x.status === "ready").length : 0;
  return n + f;
}
