// The parts of the user prompt that differ when J has tools: how to answer
// (tools instead of STRICT JSON), the booking state in one paragraph (the
// times come from check_calendar, not a pasted CALENDAR block), and the test
// lines (lines_used instead of ab_lines_used).

import { linesBlock, type OfferedLine } from "@/lib/os/experiments";
import { LINE_KEYS } from "@/lib/os/experiments/types";
import { formatSlot } from "@/lib/os/integrations/calendar/slots";
import type { ActiveCalendar } from "@/lib/os/integrations/calendar/store";
import { calendarName } from "@/lib/os/integrations/calendar/types";
import type { TraceLine } from "@/lib/os/setter/agent/trace";
import { MAX_TOOL_CALLS } from "@/lib/os/setter/agent/tools";
import type { SetterRecord } from "@/lib/os/setter/state";

/** Replaces the legacy "Respond with STRICT JSON" section. */
export function toolsBrief(o: { calendar: boolean; fields: boolean }): string {
  const lines = [
    "HOW TO ANSWER: you have tools. Ignore any instruction above to answer in JSON or to add JSON keys (fields, booking, propose_tags…): use the tools for those.",
    "- Most turns need no tool at all: just call reply.",
    "- Look things up only when you need them (get_contact, get_step, get_resource, search_knowledge).",
    "- Actions (send_resource, set_field, add_tag, set_stage, hand_to_kevin…) are queued and go out with your reply once approved. Each at most once.",
    "- Never write a link in a bubble. A resource goes via send_resource (it becomes its own bubble after yours).",
  ];
  if (o.calendar) {
    lines.push(
      "- Booking: when they say yes to a call, check_calendar and offer TWO times in ONE bubble, in their time (reply.offered_slots = the ids). If you don't know where they are, ask first. When they pick, check_calendar again to make sure it's still free; with their email, book_call and say it's done (the invite goes to their email; ask them to screenshot it once it lands). Without the email, ask for it (reply.picked_slot = the id). Never invent a time."
    );
  }
  if (o.fields) lines.push("- set_field for each FIELDS TO FILL key they just answered, in their words.");
  lines.push(
    "- Inviting (Stage 5): only when you can quote their goal and challenge in THEIR words; put them in reply.invite and set_stage('bridge'). Kevin picks the route.",
    "- hold = reply with bubbles []. Holding is valid.",
    `- At most ${MAX_TOOL_CALLS} tool calls, then reply. End EVERY turn with exactly one reply call.`
  );
  return lines.join("\n");
}

/** The booking state, without times (check_calendar has those). "" when no call is on the table. */
export function bookingStateBlock(cal: ActiveCalendar | null, rec: SetterRecord): string {
  if (!cal) return "";
  const bk = rec.booking;
  const host = cal.settings.hostTimezone;
  const tz = bk?.timezone || host;
  const head = `CALENDAR CONNECTED (${calendarName(cal.provider)}${cal.eventName ? `, "${cal.eventName}"` : ""}): you book the call inside the DM with check_calendar + book_call. Don't send the booking link from the BRAND CONTEXT.`;
  if (!bk) return head;
  if (bk.phase === "booked" || bk.phase === "link_sent" || bk.phase === "confirmed") {
    const when = bk.start ? formatSlot(bk.start, tz) : "the call";
    const state =
      bk.phase === "confirmed"
        ? `CALL CONFIRMED for ${when}. A short "see you then" is plenty, or hold. Don't sell.`
        : `ALREADY BOOKED for ${when}, waiting for their screenshot of the invite. Don't offer times again; if they want to move it, say you'll sort it (Kevin reschedules).`;
    return `${head}\n${state}`;
  }
  const so: string[] = [];
  if (bk.timezone) so.push(`their timezone: ${bk.timezone}`);
  if (bk.proposed?.length) so.push(`you offered ${bk.proposed.map((p) => formatSlot(p, tz)).join(" and ")}`);
  if (bk.picked) so.push(`they picked ${formatSlot(bk.picked, tz)}`);
  if (bk.taken?.length) so.push(`TAKEN since (never offer again): ${bk.taken.map((t) => formatSlot(t, tz)).join(", ")}`);
  if (rec.email) so.push(`their email: ${rec.email}`);
  return so.length ? `${head}\nSo far: ${so.join("; ")}.` : head;
}

/** This contact's assigned lines, as the trace / get_step show them: only
 *  the variant this person has, never the others. */
export function traceLines(lines: OfferedLine[]): TraceLine[] {
  return lines.map((l) => ({
    slot: l.slot,
    variantId: l.variantId,
    label: l.key,
    text: l.text,
    when: l.key === "opener" ? "this draft is your first reply to them" : (LINE_KEYS.find((k) => k.key === l.key)?.brief ?? undefined),
  }));
}

/** The legacy A/B LINES block, reporting through reply.lines_used. */
export function toolLinesBlock(lines: OfferedLine[]): string {
  const block = linesBlock(lines);
  return block ? block.replace(/\nList the ones you used in "ab_lines_used"[^\n]*$/, "\nList the labels you used in reply.lines_used (e.g. [\"opener\"]), [] when none.") : "";
}
