// J books the call inside the DM instead of sending a link (Kevin's way):
// offer two real times in their timezone, take the one they pick, ask for
// their email, then draft the confirmation. Kevin's Approve books it; the
// calendar sends the invite; J asks for a screenshot of it once it lands.
//
// This file is the part between the calendar and the model: what J is told
// (bookingBlock) and how its answer becomes a booking draft (applyBookingReply).
// No IO except reading free times from the ActiveCalendar passed in.

import { prefilledLink } from "@/lib/os/integrations/calendar/calendly";
import { isTimeZone } from "@/lib/os/integrations/calendar/settings";
import { fallbackDue } from "@/lib/os/integrations/calendar/setter-booking";
import { filterSlots, formatSlot, formatTime, guessTimezone, pickOptions, slotId, tzCity } from "@/lib/os/integrations/calendar/slots";
import type { ActiveCalendar } from "@/lib/os/integrations/calendar/store";
import { calendarName, type BookingPayload, type CalendarSlot } from "@/lib/os/integrations/calendar/types";
import { emailIn, iso, type BookingState, type SetterRecord, type ThreadMessage } from "@/lib/os/setter/state";
import type { SetterContact } from "@/lib/os/setter/store";

/** Where the link goes in a link-mode confirmation; the server fills it in. */
export const LINK_TOKEN = "{booking_link}";
/** Most free times listed besides the suggested ones (keeps the prompt short). */
const MORE_TIMES = 24;

export interface BookingContext {
  calendar: ActiveCalendar;
  /** Every time J may book (filtered, taken ones removed), oldest first. */
  slots: CalendarSlot[];
  /** The ones to offer first. */
  options: CalendarSlot[];
  leadTz: string | null;
  mode: "book" | "link";
}

/** Booking only starts once a call is on the table: invited, already in a
 *  booking, or the contact is at Call offered / the bridge. */
export function wantsCalendar(rec: SetterRecord, contact: Pick<SetterContact, "stage" | "setterStage">): boolean {
  if (rec.booking || rec.invited) return true;
  if (contact.stage === "CALL_OFFERED" || contact.stage === "CALL_BOOKED") return true;
  return ["bridge", "booked"].includes(String(rec.stage ?? contact.setterStage ?? ""));
}

export async function loadBookingContext(calendar: ActiveCalendar, rec: SetterRecord, msgs: ThreadMessage[], now: Date): Promise<BookingContext | null> {
  if (!calendar.eventTypeId) return null;
  const s = calendar.settings;
  const range = { start: new Date(now.getTime() + s.minNoticeHours * 3600_000), end: new Date(now.getTime() + s.daysAhead * 86_400_000) };
  const raw = await calendar.client.getAvailableSlots(calendar.eventTypeId, range, s.hostTimezone);
  const taken = new Set((rec.booking?.taken ?? []).map((t) => slotId(t)));
  const slots = filterSlots(raw, s, now, calendar.durationMinutes).filter((x) => !taken.has(x.start));
  const said = msgs.filter((m) => m.incoming).map((m) => m.text);
  const leadTz = (isTimeZone(rec.booking?.timezone) ? rec.booking!.timezone! : null) ?? guessTimezone(said);
  const options = pickOptions(slots, s.options, leadTz);
  const mode = calendar.provider === "calendly" && !s.directBooking ? "link" : "book";
  return { calendar, slots, options, leadTz, mode };
}

function slotLine(slot: CalendarSlot, ctx: BookingContext): string {
  const host = ctx.calendar.settings.hostTimezone;
  const theirs = ctx.leadTz ? `${formatSlot(slot.start, ctx.leadTz)} their time` : `${formatSlot(slot.start, host)} (${tzCity(host)} time)`;
  const yours = ctx.leadTz && ctx.leadTz !== host ? ` · ${formatTime(slot.start, host)} for you` : "";
  return `- ${slot.start} = ${theirs}${yours}`;
}

/** The CALENDAR section of the draft prompt. */
export function bookingBlock(ctx: BookingContext, rec: SetterRecord, now: Date = new Date()): string {
  const cal = ctx.calendar;
  const fallback = cal.fallbackLink ?? null;
  const host = cal.settings.hostTimezone;
  const event = cal.eventName ? `"${cal.eventName}"${cal.durationMinutes ? `, ${cal.durationMinutes} min` : ""}` : "the setter call";
  const bk = rec.booking;
  const head = `CALENDAR CONNECTED (${calendarName(cal.provider)}, ${event}). You book the call INSIDE the DM. Do NOT send the booking link from the BRAND CONTEXT.`;

  if (bk && (bk.phase === "booked" || bk.phase === "link_sent" || bk.phase === "confirmed")) {
    const when = bk.start ? formatSlot(bk.start, bk.timezone || host) + (bk.timezone ? " their time" : "") : "the call";
    const state =
      bk.phase === "confirmed"
        ? `CALL CONFIRMED for ${when}: they sent the screenshot of the invite. A short, warm "see you then" is plenty, or hold. Don't sell.`
        : bk.phase === "link_sent"
          ? `You sent them the link for ${when}. Waiting for them to book it and send a screenshot of the invite. If they say it's done, ask for the screenshot lightly (once).`
          : `ALREADY BOOKED for ${when}. Waiting for their screenshot of the calendar invite. Don't offer times again. If they want to move it, say no worries and that you'll sort it (Kevin handles the reschedule).`;
    return `${head}\n${state}\nAdd "booking": {"action": "none"} to the JSON.`;
  }

  const tzLine = ctx.leadTz
    ? `Their timezone: ${ctx.leadTz} (${tzCity(ctx.leadTz)}). Say times in THEIR time.`
    : `Their timezone: UNKNOWN. Before offering times, ask where they're based (casually, one short line, e.g. "where are you based btw? want to give you times that actually work"). The times below are in ${tzCity(host)} time.`;
  const lines = [head, tzLine];
  if (!ctx.slots.length) {
    lines.push(
      fallback
        ? `NO free times in the next ${cal.settings.daysAhead} days. Send the booking link so they pick a time themselves: ${fallback} — booking.action "none". Never invent a time.`
        : `NO free times in the next ${cal.settings.daysAhead} days. Say this week is packed and you'll come back with a time; booking.action "none". Never invent a time.`
    );
  } else {
    lines.push(`Suggested times to offer (${ctx.options.length}):\n${ctx.options.map((s) => slotLine(s, ctx)).join("\n")}`);
    const more = ctx.slots.filter((s) => !ctx.options.includes(s)).slice(0, MORE_TIMES);
    if (more.length) lines.push(`Other free times (only these exist; if they ask for a time that isn't listed, it's not free):\n${more.map((s) => slotLine(s, ctx)).join("\n")}`);
  }
  const prior: string[] = [];
  if (bk?.proposed?.length) prior.push(`you offered ${bk.proposed.map((p) => formatSlot(p, bk.timezone || ctx.leadTz || host)).join(" and ")}`);
  if (bk?.picked) prior.push(`they picked ${formatSlot(bk.picked, bk.timezone || ctx.leadTz || host)}`);
  if (bk?.taken?.length) prior.push(`TAKEN since (someone else booked it, never offer again): ${bk.taken.map((t) => formatSlot(t, bk.timezone || ctx.leadTz || host)).join(", ")}. Say sorry lightly that the time just went, and offer the suggested times`);
  if (rec.email) prior.push(`their email from the thread: ${rec.email}`);
  if (fallback && bk?.phase === "proposed" && fallbackDue(bk.at, { fallbackAfterHours: cal.fallbackAfterHours ?? 24 }, now)) {
    prior.push(`it's been over ${cal.fallbackAfterHours ?? 24}h since you offered times with no pick: don't offer new times, send the booking link (${fallback}) with no pressure`);
  }
  if (prior.length) lines.push(`So far: ${prior.join("; ")}.`);
  const confirmStep =
    ctx.mode === "link"
      ? `4. You have the time AND their email: write the confirmation with ${LINK_TOKEN} where the link goes (it opens that exact time with their details filled in, e.g. "here's the link for tuesday 3pm, your details are already in: ${LINK_TOKEN}"), then ask them to send a screenshot of the confirmation once it's booked. action "confirm".`
      : `4. You have the time AND their email: write the confirmation ("done, booked you in for tuesday 3pm your time", the invite goes to their email) and ask them to send a screenshot of the invite once it lands so you know it came through. action "confirm". Kevin's Approve books it, so say it as done.`;
  lines.push(
    [
      "How (one step per message, match their energy, never rush them):",
      "1. They said yes to a call but you don't know their timezone → ask where they're based. action \"ask_timezone\".",
      `2. Offer the suggested times in ONE bubble, their time, e.g. "would tuesday 3pm or wednesday 11am work? (your time)". action "propose", slots = the ids you offered.`,
      "3. They pick one → ask for the best email for the invite (and their name if you don't know it). action \"ask_email\", slot = the id. They want another time → take it if it's listed, otherwise " +
        (fallback
          ? `send the booking link so they pick what works: ${fallback} (action \"none\"), no more times.`
          : "say so lightly and offer the two closest listed ones (action \"propose\")."),
      confirmStep,
      "Never say it's booked before action \"confirm\". Never invent a time or an id. If they haven't said yes to a call, ignore this section (action \"none\").",
    ].join("\n")
  );
  lines.push(
    'Add to the JSON: "booking": {"action": "none|ask_timezone|propose|ask_email|confirm", "slots": [], "slot": null, "timezone": null, "email": null, "name": null}. ' +
      "slot/slots are ids from the lists above, exactly. timezone = an IANA name (e.g. Europe/London) when they told you where they are. email/name only as they wrote them."
  );
  return lines.join("\n\n");
}

// ---------------------------------------------------------------- the model's answer
export type BookingAction = "none" | "ask_timezone" | "propose" | "ask_email" | "confirm";

export interface BookingReply {
  action: BookingAction;
  slots: string[];
  slot: string | null;
  timezone: string | null;
  email: string | null;
  name: string | null;
}

const ACTIONS: BookingAction[] = ["none", "ask_timezone", "propose", "ask_email", "confirm"];

export function readBookingReply(raw: unknown): BookingReply | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Record<string, unknown>;
  const action = ACTIONS.includes(b.action as BookingAction) ? (b.action as BookingAction) : "none";
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  return {
    action,
    slots: Array.isArray(b.slots) ? b.slots.map(str).filter((s): s is string => Boolean(s)).slice(0, 5) : [],
    slot: str(b.slot),
    timezone: str(b.timezone),
    email: str(b.email),
    name: str(b.name),
  };
}

function normSlot(id: string | null | undefined): string | null {
  if (!id) return null;
  const d = new Date(id);
  return Number.isFinite(d.getTime()) ? slotId(d) : null;
}

export interface BookingDecision {
  /** "booking" when this draft books on Approve. */
  kind: "booking" | null;
  payload: BookingPayload | null;
  bubbles: string[];
  flags: string[];
  /** The booking state to keep once this draft is sent (rec.draft.booking). */
  next: BookingState | null;
  /** Their timezone, saved right away (it's a fact, not a send). */
  timezone: string | null;
}

/** Turn J's booking answer into the draft: a booking draft when it has a
 *  free time and an email, otherwise a normal reply with the right flags. */
export function applyBookingReply(
  reply: BookingReply | null,
  ctx: BookingContext,
  rec: SetterRecord,
  contact: Pick<SetterContact, "username" | "fullName" | "email">,
  bubblesIn: string[],
  now: Date
): BookingDecision {
  const at = iso(now)!;
  const host = ctx.calendar.settings.hostTimezone;
  const free = new Map(ctx.slots.map((s) => [s.start, s]));
  const timezone = (isTimeZone(reply?.timezone) ? reply!.timezone : null) ?? ctx.leadTz ?? null;
  const prev = rec.booking ?? null;
  const base: BookingState = { ...(prev ?? { phase: "proposed", at }), timezone: timezone ?? prev?.timezone ?? null };
  const out: BookingDecision = { kind: null, payload: null, bubbles: stripToken(bubblesIn), flags: [], next: null, timezone };
  if (!reply || reply.action === "none") return out;

  if (reply.action === "ask_timezone") {
    out.next = { ...base, phase: "asked_timezone", at };
    return out;
  }
  if (reply.action === "propose") {
    const offered = reply.slots.map(normSlot).filter((s): s is string => Boolean(s && free.has(s)));
    out.next = { ...base, phase: "proposed", proposed: offered.length ? offered : ctx.options.map((o) => o.start), picked: null, at };
    return out;
  }
  const picked = normSlot(reply.slot) ?? prev?.picked ?? null;
  const slot = picked ? free.get(picked) : undefined;
  if (reply.action === "ask_email") {
    out.next = { ...base, phase: "awaiting_email", picked: slot ? slot.start : picked, at };
    if (picked && !slot) out.flags.push("slot_unavailable");
    return out;
  }

  // confirm
  const email = emailIn(reply.email) ?? rec.email ?? contact.email ?? null;
  if (!slot) {
    out.flags.push("slot_unavailable");
    out.next = { ...base, phase: "proposed", picked: null, at };
    return out;
  }
  if (!email) {
    out.flags.push("needs_email");
    out.next = { ...base, phase: "awaiting_email", picked: slot.start, at };
    return out;
  }
  const name = reply.name || contact.fullName?.trim() || contact.username || "Instagram lead";
  const duration = ctx.calendar.durationMinutes;
  const end = slot.end ?? (duration ? slotId(new Date(new Date(slot.start).getTime() + duration * 60_000)) : null);
  const url = ctx.mode === "link" && slot.bookingUrl ? prefilledLink(slot.bookingUrl, name, email) : null;
  out.kind = "booking";
  out.flags.push("booking");
  out.payload = {
    provider: ctx.calendar.provider,
    eventTypeId: ctx.calendar.eventTypeId!,
    eventName: ctx.calendar.eventName,
    durationMinutes: duration,
    start: slot.start,
    end,
    timezone: timezone ?? host,
    hostTimezone: host,
    name,
    email,
    mode: url ? "link" : "book",
    url,
  };
  out.bubbles = url ? withLink(bubblesIn, url) : stripToken(bubblesIn);
  out.next = { ...base, phase: "awaiting_email", picked: slot.start, at };
  return out;
}

function stripToken(bubbles: string[]): string[] {
  return bubbles.map((b) => b.replaceAll(LINK_TOKEN, "").replace(/\s{2,}/g, " ").trim()).filter(Boolean);
}

function withLink(bubbles: string[], url: string): string[] {
  if (bubbles.some((b) => b.includes(LINK_TOKEN))) return bubbles.map((b) => b.replaceAll(LINK_TOKEN, url));
  return [...bubbles, url];
}
