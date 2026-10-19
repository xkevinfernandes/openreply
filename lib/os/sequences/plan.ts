// The follow-up planner: given one contact (J's record, their latest call,
// the setter's sequences and what already went out), which ONE step is next
// and when. Pure: no IO, no clock (now is passed in), so the scheduling math
// is tested on fixed dates.
//
// One live step per contact, ever: the engine (engine.ts) keeps exactly the
// step this returns queued and cancels anything else. A step's key is unique,
// so planning is idempotent: the same facts give the same key.
//
// Which sequence:
//   1. a live call in the future         → pre_call (reminders in THEIR timezone)
//   2. the call is over, marked no-show  → no_show (stops when they reply)
//   3. the call is over, showed / not marked yet → nothing (a task for Kevin)
//   4. we wrote last, they went quiet    → no_reply_<stage> (stops when they reply)
//
// Meta's window: a step goes in the free 24h window, or under HUMAN_AGENT
// (approve-only) up to 7 days after their last message. A step that would
// land after that is squeezed in before the window closes, or dropped.

import { slotId } from "@/lib/os/integrations/calendar/slots";
import { DEFAULT_TIMERS, FREEZE_TAGS, iso, parseIso, type SetterRecord, type StateConfig } from "@/lib/os/setter/state";
import type { NoReplyKey, SequenceKey, SequenceSet, SequenceStep } from "@/lib/os/sequences/types";
import { addDays, localDate, safeTz, zonedTimeToUtc } from "@/lib/os/sequences/time";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Cancel reason meaning "Kevin stopped this sequence": the rest of this
 *  episode never queues. Other cancel reasons are the engine moving on. */
export const STOPPED = "stopped";
/** A reminder needs this much room before the call. */
const LAST_CALL_MIN = 10 * MIN;
/** A nurture piece only goes when the call is at least this far away… */
const NURTURE_MIN_LEAD = 12 * HOUR;
/** …and not this close to a reminder. */
const NURTURE_GAP = 3 * HOUR;
/** Room left before the window closes when a late step is squeezed in. */
const WINDOW_MARGIN = 2 * HOUR;
/** A squeezed step still needs this much air after the previous one. */
const MIN_STEP_GAP = 6 * HOUR;
/** Without an end time, a call is over this long after it started. */
const DEFAULT_CALL = 30 * MIN;

export type StepStatusName = "QUEUED" | "DRAFTED" | "SENT" | "SKIPPED" | "CANCELLED";

export interface StepHistory {
  key: string;
  sequence: string;
  episode: string;
  stepId: string;
  status: StepStatusName;
  reason: string | null;
  /** When it was sent / skipped / cancelled. */
  doneAt: string | null;
}

export interface PlanBooking {
  id: string;
  start: string;
  end: string | null;
  /** The lead's IANA timezone. */
  timezone: string;
  status: "BOOKED" | "CONFIRMED" | "LINK_SENT" | "CANCELLED";
  attendance: "SHOWED" | "NO_SHOW" | null;
  createdAt: string;
  cancelledAt?: string | null;
}

export interface PlanContact {
  kind: "SALES" | "PERSONAL" | "UNSORTED" | "PITCHES";
  paused: boolean;
  /** Per-thread "Follow-ups off". */
  followupsOff: boolean;
  tags: string[];
  /** J's setting stage on the contact (the record's wins). */
  setterStage?: string | null;
}

export interface PlanInput {
  now: Date;
  contact: PlanContact;
  rec: SetterRecord | null;
  /** Their latest call (cancelled included, so a cancel can stop things). */
  booking: PlanBooking | null;
  sequences: SequenceSet;
  history: StepHistory[];
  cfg?: StateConfig;
}

export interface PlannedStep {
  sequence: SequenceKey;
  stepIndex: number;
  stepCount: number;
  step: SequenceStep;
  /** Groups the steps of one run: a new silence / booking / no-show starts a new one. */
  episode: string;
  key: string;
  dueAt: string;
  bookingId: string | null;
}

export interface PlanResult {
  plan: PlannedStep | null;
  /** Why nothing is planned, in words for the thread strip. */
  why: string;
}

const none = (why: string): PlanResult => ({ plan: null, why });

function timers(cfg?: StateConfig) {
  return { ...DEFAULT_TIMERS, ...(cfg?.timers ?? {}) };
}

const isDone = (h: StepHistory) => h.status === "SENT" || h.status === "SKIPPED";

/** The last moment a message can go: their last message + 7 days (minus the safety margin). */
export function windowCloses(theirLastAt: string | null | undefined, cfg?: StateConfig): Date | null {
  const last = parseIso(theirLastAt);
  if (!last) return null;
  const t = timers(cfg);
  return new Date(last.getTime() + t.human_agent_days * DAY - t.window_safety_minutes * MIN);
}

/** Fit a due time inside the window: as is, squeezed before it closes, or null. */
function fitWindow(due: Date, base: Date, closes: Date | null): Date | null {
  if (!closes) return null;
  if (due.getTime() < closes.getTime()) return due;
  const squeezed = new Date(closes.getTime() - WINDOW_MARGIN);
  return squeezed.getTime() - base.getTime() >= MIN_STEP_GAP ? squeezed : null;
}

// ---------------------------------------------------------------- gates
const STOP_TAGS = [...FREEZE_TAGS, "not_now", "not_now_auto"];

function gate(input: PlanInput): string | null {
  const c = input.contact;
  if (c.kind !== "SALES") return "Follow-ups run for Sales contacts only.";
  if (c.paused) return "J is paused for this contact.";
  if (c.followupsOff) return "Follow-ups are off for this thread.";
  const tag = c.tags.find((t) => STOP_TAGS.includes(t));
  if (tag) return `Tagged ${tag.replace(/_/g, " ")}: no follow-ups.`;
  const st = input.rec?.state;
  if (st === "frozen" || st === "not_now") return st === "frozen" ? "J is frozen for this contact." : "J has them as not now.";
  return null;
}

// ---------------------------------------------------------------- which no-reply sequence
/** The stage they went quiet in. */
export function noReplyKeyFor(rec: SetterRecord, contactStage?: string | null): NoReplyKey {
  const st = String(rec.stage ?? contactStage ?? "");
  const phase = rec.booking?.phase;
  if (rec.invited || st === "bridge" || phase === "asked_timezone" || phase === "proposed" || phase === "awaiting_email" || phase === "link_sent") {
    return "no_reply_invite";
  }
  if (st === "permission" || st === "qualify") return "no_reply_qualifying";
  if (st === "value" || rec.delivered_at || (rec.resources_sent ?? []).length) return "no_reply_value";
  return "no_reply_lead";
}

// ---------------------------------------------------------------- pre-call timeline
export interface PreCallEntry {
  step: SequenceStep;
  index: number;
  key: string;
  dueAt: Date;
  /** Set when this step won't go for this booking, and why. */
  dropped: string | null;
}

export function preCallKey(booking: Pick<PlanBooking, "id" | "start">, step: SequenceStep): string {
  // A nurture piece is per booking (a reschedule never resends it); a reminder
  // is per call time (a reschedule re-plans it).
  return step.resource ? `pre_call:${booking.id}:${step.id}` : `pre_call:${booking.id}:${slotId(booking.start)}:${step.id}`;
}

/** Every pre-call step for this booking: when it would go, or why it won't. */
export function preCallTimeline(steps: SequenceStep[], booking: PlanBooking): PreCallEntry[] {
  const start = new Date(booking.start);
  const created = new Date(booking.createdAt);
  const tz = safeTz(booking.timezone);
  const callDay = localDate(start, tz);
  const entries: PreCallEntry[] = steps.map((step, index) => {
    const t = step.timing;
    const dueAt =
      t.kind === "after"
        ? new Date(created.getTime() + t.minutes * MIN)
        : t.kind === "before_call"
          ? new Date(start.getTime() - t.minutes * MIN)
          : zonedTimeToUtc(t.kind === "day_before" ? addDays(callDay, -1) : callDay, t.time, tz);
    let dropped: string | null = null;
    if (dueAt.getTime() > start.getTime() - LAST_CALL_MIN) dropped = "would land after the call";
    else if (dueAt.getTime() < created.getTime()) dropped = "booked too close to the call";
    else if (step.resource && start.getTime() - dueAt.getTime() < NURTURE_MIN_LEAD) dropped = "call too soon for a nurture piece";
    return { step, index, key: preCallKey(booking, step), dueAt, dropped };
  });
  // A nurture piece never crowds a reminder.
  const reminders = entries.filter((e) => !e.step.resource && !e.dropped);
  for (const e of entries) {
    if (!e.step.resource || e.dropped) continue;
    if (reminders.some((r) => Math.abs(r.dueAt.getTime() - e.dueAt.getTime()) < NURTURE_GAP)) e.dropped = "too close to a reminder";
  }
  // …nor another nurture piece.
  const kept: PreCallEntry[] = [];
  for (const e of [...entries].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime())) {
    if (!e.dropped && e.step.resource && kept.some((k) => k.step.resource && Math.abs(k.dueAt.getTime() - e.dueAt.getTime()) < NURTURE_GAP)) {
      e.dropped = "too close to the other nurture piece";
    }
    if (!e.dropped) kept.push(e);
  }
  return entries.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.index - b.index);
}

function planPreCall(input: PlanInput, b: PlanBooking): PlanResult {
  const seq = input.sequences.pre_call;
  if (!seq.enabled) return none("Before-the-call follow-ups are switched off for this setter.");
  if (input.history.some((h) => h.sequence === "pre_call" && h.episode === b.id && h.status === "CANCELLED" && h.reason === STOPPED)) {
    return none("You cancelled the reminders for this call.");
  }
  const now = input.now.getTime();
  const start = new Date(b.start).getTime();
  const live = preCallTimeline(seq.steps, b).filter((e) => !e.dropped);
  const doneKeys = new Set(input.history.filter(isDone).map((h) => h.key));
  for (let i = 0; i < live.length; i++) {
    const e = live[i];
    if (doneKeys.has(e.key)) continue;
    const expires = live[i + 1]?.dueAt.getTime() ?? start - LAST_CALL_MIN;
    if (e.dueAt.getTime() <= now && expires <= now) continue; // missed; the next one is due
    return {
      plan: {
        sequence: "pre_call",
        stepIndex: e.index,
        stepCount: seq.steps.length,
        step: e.step,
        episode: b.id,
        key: e.key,
        dueAt: iso(e.dueAt)!,
        bookingId: b.id,
      },
      why: "",
    };
  }
  return none("Every reminder for this call has gone out.");
}

// ---------------------------------------------------------------- sequential sequences
/** The next step of a step-after-step sequence (no reply, no-show). */
function planSequential(
  input: PlanInput,
  key: SequenceKey,
  episode: string,
  firstBase: Date,
  keyOf: (step: SequenceStep) => string,
  bookingId: string | null
): PlanResult {
  const seq = input.sequences[key];
  const mine = input.history.filter((h) => h.sequence === key && h.episode === episode);
  if (mine.some((h) => h.status === "CANCELLED" && h.reason === STOPPED)) return none("You cancelled this sequence. It starts again after their next reply.");
  const done = new Set(mine.filter(isDone).map((h) => h.stepId));
  const idx = seq.steps.findIndex((s) => !done.has(s.id));
  if (idx < 0) return none(seq.steps.length ? "Sequence finished. J waits for them now." : "This sequence has no steps.");
  const step = seq.steps[idx];
  const lastDone = mine
    .filter(isDone)
    .map((h) => parseIso(h.doneAt))
    .filter((d): d is Date => Boolean(d))
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const base = lastDone && lastDone > firstBase ? lastDone : firstBase;
  const minutes = step.timing.kind === "after" ? step.timing.minutes : 24 * 60;
  const due = fitWindow(new Date(base.getTime() + minutes * MIN), base, windowCloses(input.rec?.their_last_at, input.cfg));
  if (!due) return none("Instagram's 7-day window closes before the next step, so the sequence ends here.");
  return {
    plan: { sequence: key, stepIndex: idx, stepCount: seq.steps.length, step, episode, key: keyOf(step), dueAt: iso(due)!, bookingId },
    why: "",
  };
}

function callOver(b: PlanBooking): number {
  return b.end ? new Date(b.end).getTime() : new Date(b.start).getTime() + DEFAULT_CALL;
}

function planNoShow(input: PlanInput, b: PlanBooking): PlanResult {
  const seq = input.sequences.no_show;
  if (!seq.enabled) return none("The no-show sequence is switched off for this setter.");
  const theirLast = parseIso(input.rec?.their_last_at);
  if (theirLast && theirLast.getTime() > new Date(b.start).getTime()) return none("They wrote after the call time, so J answers them instead.");
  const episode = `no_show:${b.id}`;
  return planSequential(input, "no_show", episode, new Date(callOver(b)), (s) => `${episode}:${s.id}`, b.id);
}

function planNoReply(input: PlanInput): PlanResult {
  const rec = input.rec;
  if (!rec) return none("J hasn't looked at this thread yet.");
  const theirLast = parseIso(rec.their_last_at);
  const ourLast = parseIso(rec.our_last_at);
  if (!ourLast) return none("Waiting for J's first message.");
  if (!theirLast) return none("They haven't written yet, so Instagram gives no window.");
  if (theirLast >= ourLast) return none("They wrote last: J answers, no follow-up needed.");
  if (rec.next_action?.kind === "value_opener") return none("J's value opener is due first.");
  if (["booked", "unreachable"].includes(rec.state) || input.contact.tags.includes("booked")) return none("Booked: the before-the-call reminders take over.");
  const phase = rec.booking?.phase;
  if (phase === "booked" || phase === "confirmed") return none("Booked: the before-the-call reminders take over.");
  const key = noReplyKeyFor(rec, input.contact.setterStage);
  if (!input.sequences[key].enabled) return none("No-reply follow-ups for this stage are switched off for this setter.");
  // One silence = one episode: their reply ends it, the next silence starts over.
  const episode = `${key}:${rec.their_last_at}`;
  return planSequential(input, key, episode, ourLast, (s) => `${episode}:${s.id}`, null);
}

// ---------------------------------------------------------------- the planner
export function planFollowup(input: PlanInput): PlanResult {
  const blocked = gate(input);
  if (blocked) return none(blocked);
  const b = input.booking;
  const now = input.now.getTime();
  if (b && b.status !== "CANCELLED" && b.status !== "LINK_SENT") {
    if (new Date(b.start).getTime() > now) return planPreCall(input, b);
    if (b.attendance === "NO_SHOW") return planNoShow(input, b);
    if (b.attendance === "SHOWED") return none("They showed. Your voice-note task is on Home.");
    if (callOver(b) > now) return none("The call is on now.");
    return none("Did they show? Mark Showed or No-show.");
  }
  if (b?.status === "CANCELLED") {
    const cancelled = parseIso(b.cancelledAt);
    const theirLast = parseIso(input.rec?.their_last_at);
    if (cancelled && (!theirLast || cancelled > theirLast)) return none("The call was cancelled. J waits for them to write.");
  }
  return planNoReply(input);
}
