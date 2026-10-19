// The server's side of J's actions: each call is checked when J makes it (so
// J hears why and can fix it), queued, and at the end of the turn mapped onto
// the SAME draft object the legacy one-call path returns (bubbles,
// stage_proposed, propose_tags, fields, booking, invite…). service.ts then
// treats both paths alike: Inbox, Approve, Auto and field capture are unchanged.

import { slotId } from "@/lib/os/integrations/calendar/slots";
import { sendableResources, usableCalendar, type AgentEnv, type TurnState } from "@/lib/os/setter/agent/context";
import { EXITS, STAGES, type ActionTool } from "@/lib/os/setter/agent/tools";
import type { TraceAction } from "@/lib/os/setter/agent/trace";
import type { BookingReply } from "@/lib/os/setter/booking";
import { tagOptions, type DraftObject } from "@/lib/os/setter/prompt";
import { emailIn } from "@/lib/os/setter/state";

export interface QueuedAction {
  name: ActionTool;
  input: Record<string, unknown>;
}

export type Check = { ok: true; key: string } | { ok: false; reason: string };

const s = (v: unknown, max = 500): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function normSlot(id: unknown): string | null {
  if (typeof id !== "string" || !id.trim()) return null;
  const d = new Date(id.trim());
  return Number.isFinite(d.getTime()) ? slotId(d) : null;
}

/** The URL check for bubbles: links only come from send_resource / booking. */
const URL_RE = /\bhttps?:\/\/\S+|\bwww\.[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|co|me|net|org|ly|app|link|gg|so|ai|dev)\/\S*/gi;

export function hasUrl(text: string): boolean {
  URL_RE.lastIndex = 0;
  return URL_RE.test(text);
}

export function stripUrls(text: string): string {
  return text.replace(URL_RE, "").replace(/\s{2,}/g, " ").trim();
}

/** Validate one action call against the setter's rules and this turn. */
export function checkAction(env: AgentEnv, state: TurnState, name: ActionTool, input: Record<string, unknown>, done: Set<string>): Check {
  const once = (key: string): Check => (done.has(key) ? { ok: false, reason: `Already queued this turn (${key}). Each action at most once.` } : { ok: true, key });
  const tags = tagOptions(env.setter.catalog);
  switch (name) {
    case "send_resource": {
      const slug = s(input.slug, 200);
      const all = sendableResources(env.setter, usableCalendar(env.calendar));
      if (!all.has(slug)) return { ok: false, reason: `"${slug}" isn't a resource this setter may send. Allowed: ${[...all.keys()].join(", ") || "none"}.` };
      return once(`send_resource:${slug}`);
    }
    case "book_call": {
      if (!usableCalendar(env.calendar)) return { ok: false, reason: "No calendar is connected, so you can't book. Send the booking link instead if there is one." };
      const slot = normSlot(input.slot);
      if (!slot || !state.slots.has(slot)) return { ok: false, reason: "That slot isn't from check_calendar in this turn. Call check_calendar, then book one of its ids exactly." };
      const email = emailIn(s(input.email)) ?? env.rec.email ?? env.contact.email ?? null;
      if (!email) return { ok: false, reason: "No email: ask them for the best email for the invite first (don't book yet)." };
      return once("book_call");
    }
    case "set_field": {
      const key = s(input.key, 100);
      const fields = env.setter.profile.fields ?? [];
      if (!fields.some((f) => f.key === key)) return { ok: false, reason: `"${key}" isn't in Fields J fills. Allowed: ${fields.map((f) => f.key).join(", ") || "none"}.` };
      if (!s(input.value)) return { ok: false, reason: "Empty value: only save what they actually said." };
      return once(`set_field:${key}`);
    }
    case "add_tag":
    case "remove_tag": {
      const tag = s(input.tag, 100);
      if (!tags.includes(tag)) return { ok: false, reason: `"${tag}" isn't an allowed tag. Allowed: ${tags.join(", ")}.` };
      return once(`tag:${tag}`);
    }
    case "set_stage": {
      const stage = s(input.stage, 50);
      if (!(STAGES as readonly string[]).includes(stage)) return { ok: false, reason: `Unknown stage. One of: ${STAGES.join(", ")}.` };
      return once("set_stage");
    }
    case "exit_step": {
      const exit = s(input.exit, 50);
      if (!(EXITS as readonly string[]).includes(exit)) return { ok: false, reason: `Unknown exit. One of: ${EXITS.join(", ")}.` };
      return once("exit_step");
    }
    case "hand_to_kevin":
      return once("hand_to_kevin");
  }
}

// ---------------------------------------------------------------- the reply
export interface ReplyInput {
  bubbles: string[];
  linesUsed: string[];
  reasoning: string | null;
  offeredSlots: string[];
  pickedSlot: string | null;
  holdReason: string | null;
  invite: Record<string, unknown> | null;
  fitScore: number | null;
}

export function readReply(raw: Record<string, unknown>): ReplyInput {
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : typeof v === "string" && v.trim() ? [v.trim()] : []);
  const inv = raw.invite && typeof raw.invite === "object" && !Array.isArray(raw.invite) ? (raw.invite as Record<string, unknown>) : null;
  const fit = typeof raw.fit_score === "number" && Number.isFinite(raw.fit_score) ? raw.fit_score : null;
  return {
    bubbles: list(raw.bubbles),
    linesUsed: list(raw.lines_used),
    reasoning: s(raw.reasoning, 2000) || null,
    offeredSlots: list(raw.offered_slots),
    pickedSlot: s(raw.picked_slot, 100) || null,
    holdReason: s(raw.hold_reason, 300) || null,
    invite: inv && Object.keys(inv).length ? inv : null,
    fitScore: fit,
  };
}

// ---------------------------------------------------------------- the draft object
export interface MappedTurn {
  /** The legacy draft object (what Draft.raw holds, plus `actions`). */
  obj: DraftObject;
  /** send_resource links, one bubble each, after the reply (and booking) bubbles. */
  resourceBubbles: string[];
  /** Draft flags from actions (hand_to_kevin). */
  flags: string[];
  /** The trace's view of every action, after the end-of-turn checks. */
  actions: TraceAction[];
  notes: string[];
}

/**
 * Turn the queued actions and the reply into the legacy draft object.
 * A paused contact or a closed window drops every action (the reply stays;
 * the service decides whether it may go at all).
 */
export function mapTurn(env: AgentEnv, state: TurnState, queued: QueuedAction[], rejected: TraceAction[], reply: ReplyInput | null): MappedTurn {
  const notes: string[] = [];
  const dropAll = env.contact.paused ? "contact paused" : env.windowClosed ? "Instagram window closed" : null;
  const actions: TraceAction[] = [...rejected];
  const live: QueuedAction[] = [];
  for (const q of queued) {
    if (dropAll) actions.push({ name: q.name, input: q.input, status: "dropped", reason: dropAll });
    else {
      actions.push({ name: q.name, input: q.input, status: "queued" });
      live.push(q);
    }
  }
  if (env.dry) notes.push("sandbox: actions recorded only");

  const obj: DraftObject = {};
  const bubbles = reply?.bubbles ?? [];
  obj.bubbles = bubbles;
  obj.stage_reasoning = reply?.reasoning ?? undefined;
  obj.ab_lines_used = reply?.linesUsed ?? [];
  obj.propose_tags = {};
  obj.fields = {};
  const resourceBubbles: string[] = [];
  const flags: string[] = [];
  const sendable = sendableResources(env.setter, usableCalendar(env.calendar));

  for (const q of live) {
    const i = q.input;
    switch (q.name) {
      case "send_resource": {
        const r = sendable.get(s(i.slug, 200));
        if (r) {
          resourceBubbles.push(r.url);
          obj.resources_sent = [...((obj.resources_sent as string[]) ?? []), r.slug];
        }
        break;
      }
      case "book_call":
        obj.booking = {
          action: "confirm",
          slot: normSlot(i.slot),
          slots: [],
          email: emailIn(s(i.email)) ?? null,
          name: s(i.name, 200) || null,
          timezone: state.leadTz,
        } satisfies BookingReply;
        break;
      case "set_field":
        (obj.fields as Record<string, string>)[s(i.key, 100)] = s(i.value, 2000);
        break;
      case "add_tag":
        (obj.propose_tags as Record<string, string>)[s(i.tag, 100)] = s(i.reason, 300) || "J";
        break;
      case "remove_tag":
        obj.remove_tags = [...((obj.remove_tags as string[]) ?? []), s(i.tag, 100)];
        break;
      case "set_stage":
        obj.stage_proposed = s(i.stage, 50);
        break;
      case "exit_step":
        obj.exit = { exit: s(i.exit, 50), reason: s(i.reason, 300) };
        break;
      case "hand_to_kevin":
        obj.hand_to_kevin = s(i.reason, 300) || "J asked for Kevin";
        flags.push("hand_to_kevin");
        break;
    }
  }

  // The booking steps that aren't actions: offering times, a time picked.
  if (!obj.booking && reply && !dropAll) {
    const offered = reply.offeredSlots.map(normSlot).filter((x): x is string => Boolean(x && state.slots.has(x)));
    if (reply.offeredSlots.length && offered.length < reply.offeredSlots.length) notes.push("offered_slots: ids not from check_calendar were ignored");
    const picked = normSlot(reply.pickedSlot);
    if (picked && !state.slots.has(picked)) notes.push("picked_slot: not from check_calendar, ignored");
    if (picked && state.slots.has(picked)) obj.booking = { action: "ask_email", slot: picked, slots: [], email: null, name: null, timezone: state.leadTz } satisfies BookingReply;
    else if (offered.length) obj.booking = { action: "propose", slots: offered, slot: null, email: null, name: null, timezone: state.leadTz } satisfies BookingReply;
  }

  if (reply?.invite && !dropAll) {
    obj.invite = reply.invite;
    obj.invite_ready = true;
  }
  if (reply?.fitScore != null) obj.qualification = { fit_score: reply.fitScore };
  if (!bubbles.length && !resourceBubbles.length) {
    obj.hold = true;
    obj.hold_reason = reply?.holdReason ?? (reply ? "J chose to hold" : "no reply");
  }
  obj.actions = actions.filter((a) => a.status === "queued").map((a) => ({ name: a.name, input: a.input }));
  return { obj, resourceBubbles, flags, actions, notes };
}
