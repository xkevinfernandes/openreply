// J's tools (spec 2026-10-19-setter-agent-spec.md §2). Read tools answer
// straight away; action tools are queued with the draft and validated by the
// server; `reply` ends the turn. The definitions are deterministic for a given
// setup (same order, same text), so the tools + system prefix stays cached.

import type Anthropic from "@anthropic-ai/sdk";
import type { ToolKind } from "@/lib/os/setter/agent/trace";

export const READ_TOOLS = ["get_contact", "get_step", "check_calendar", "get_resource", "search_knowledge"] as const;
export const ACTION_TOOLS = ["send_resource", "book_call", "set_field", "add_tag", "remove_tag", "set_stage", "exit_step", "hand_to_kevin"] as const;
export type ReadTool = (typeof READ_TOOLS)[number];
export type ActionTool = (typeof ACTION_TOOLS)[number];
export type ToolName = ReadTool | ActionTool | "reply";

/** Most tool calls in one turn (reply not counted); after that J must reply. */
export const MAX_TOOL_CALLS = 8;

export const STAGES = ["opener", "value", "permission", "qualify", "bridge", "booked"] as const;
export const EXITS = ["not_a_fit", "stopped", "goal_met"] as const;

export function toolKind(name: string): ToolKind {
  if (name === "reply") return "reply";
  return (ACTION_TOOLS as readonly string[]).includes(name) ? "action" : "read";
}

type Schema = Anthropic.Tool["input_schema"];
const obj = (properties: Record<string, unknown>, required: string[] = []): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const str = (description: string) => ({ type: "string", description });

const DEFS: Record<ToolName, { description: string; input_schema: Schema }> = {
  get_contact: {
    description:
      "Who you're talking to: name, handle, email if known, fields filled so far (and who filled them), tags, stage, bookings, resources already sent, how they arrived. Use when you need a fact you don't see in the prompt.",
    input_schema: obj({}),
  },
  get_step: {
    description:
      "The step you're in: the goal, the lead magnet rule (and which resources you may send), release rules, exits, and the exact wording of any line Kevin is testing with this person. Use it before an opener, a permission ask, an invite or a nudge.",
    input_schema: obj({}),
  },
  check_calendar: {
    description:
      "Real free times for the call, in their timezone. Call it when they said yes to a call (to offer two times) and again right before book_call (to make sure the time is still free). Only times returned here can be offered or booked this turn. Each time has an id: quote it exactly.",
    input_schema: obj(
      {
        from: str("Earliest day to look, YYYY-MM-DD. Optional (default: now + notice)."),
        to: str("Latest day to look, YYYY-MM-DD. Optional (default: the calendar's horizon)."),
        tz: str("Their IANA timezone (e.g. Europe/London) when they told you where they are. Optional."),
      },
      []
    ),
  },
  get_resource: {
    description: "A lead magnet / resource you may send: title, kind, one-line summary, whether it has a link. You never type links; send_resource adds it.",
    input_schema: obj({ slug: str("The resource slug, as listed in RESOURCES.") }, ["slug"]),
  },
  search_knowledge: {
    description: "Search Kevin's knowledge (offers, objections, business facts, voice examples, best episodes) when the prompt summary isn't enough. Returns the best passages.",
    input_schema: obj({ query: str("A few words, e.g. 'price objection' or 'what the program includes'.") }, ["query"]),
  },
  send_resource: {
    description:
      "Queue a resource link to go out as its own bubble after your reply. Only resources this setter may send (and 'booking_link' when there's no calendar). Never write the link yourself.",
    input_schema: obj({ slug: str("The resource slug.") }, ["slug"]),
  },
  book_call: {
    description:
      "Queue the booking. The slot must be an id from check_calendar in THIS turn. Kevin's Approve books it, so your reply can say it as done ('locked in, invite's on its way'). Needs their email (from the thread or this call).",
    input_schema: obj(
      {
        slot: str("The slot id from check_calendar, exactly."),
        email: str("Their email, as they wrote it."),
        name: str("Their name for the invite, if you know it."),
      },
      ["slot", "email"]
    ),
  },
  set_field: {
    description: "Save something they told you to a custom field. Only keys from FIELDS TO FILL. The value in their words. Never guess.",
    input_schema: obj({ key: str("The field key."), value: str("What they said.") }, ["key", "value"]),
  },
  add_tag: {
    description: "Propose a tag for the contact. Only tags from the allowed list.",
    input_schema: obj({ tag: str("The tag."), reason: str("One line: why.") }, ["tag", "reason"]),
  },
  remove_tag: {
    description: "Propose removing a tag the contact has. Only tags from the allowed list.",
    input_schema: obj({ tag: str("The tag."), reason: str("One line: why.") }, ["tag", "reason"]),
  },
  set_stage: {
    description: "Move the contact to a funnel stage when this reply moves them.",
    input_schema: obj({ stage: { type: "string", enum: [...STAGES] } }, ["stage"]),
  },
  exit_step: {
    description: "Leave the current step: not_a_fit (not someone we can help), stopped (they asked to stop), goal_met.",
    input_schema: obj({ exit: { type: "string", enum: [...EXITS] }, reason: str("One line.") }, ["exit", "reason"]),
  },
  hand_to_kevin: {
    description: "Hold this draft for Kevin even when the stage runs on Auto: complaint, refund, 'is this AI?', anything you're unsure about.",
    input_schema: obj({ reason: str("One line.") }, ["reason"]),
  },
  reply: {
    description:
      "End the turn with the messages to send. bubbles = separate DM bubbles, short, in your voice, no links (links only via send_resource/book_call). An empty list means hold: send nothing. lines_used = the test lines you used (labels from get_step). Call it exactly once, last.",
    input_schema: obj(
      {
        bubbles: { type: "array", items: { type: "string" }, description: "The bubbles, in order. [] = hold." },
        lines_used: { type: "array", items: { type: "string" }, description: "Labels of the test lines you used, e.g. ['permission_ask']." },
        reasoning: str("One or two lines: why this reply (Kevin reads it)."),
        offered_slots: { type: "array", items: { type: "string" }, description: "When you offered times: their ids from check_calendar." },
        picked_slot: str("When they picked a time and you're asking for their email: its id."),
        hold_reason: str("When bubbles is []: why you hold."),
        invite: {
          type: "object",
          description: "Only when this reply invites them (Stage 5): their goal and challenge in THEIR words.",
          properties: {
            offer: { type: "string" },
            route_suggestion: { type: "string", enum: ["call", "doc", "voice"] },
            why_fit: { type: "string" },
            their_goal: { type: "string" },
            their_challenge: { type: "string" },
            in_the_way: { type: "string" },
          },
          additionalProperties: false,
        },
        fit_score: { type: "number", description: "0-5, how good a fit they look so far." },
      },
      ["bubbles", "lines_used", "reasoning"]
    ),
  },
};

export function toolDef(name: ToolName): Anthropic.Tool {
  return { name, ...DEFS[name] };
}

export interface ToolAvailability {
  calendar: boolean;
  fields: boolean;
  resources: boolean;
}

/** The tools offered this turn, in a fixed order (cache-friendly). */
export function toolsFor(a: ToolAvailability): ToolName[] {
  const out: ToolName[] = ["get_contact", "get_step"];
  if (a.calendar) out.push("check_calendar");
  out.push("get_resource", "search_knowledge");
  if (a.resources) out.push("send_resource");
  if (a.calendar) out.push("book_call");
  if (a.fields) out.push("set_field");
  out.push("add_tag", "remove_tag", "set_stage", "exit_step", "hand_to_kevin", "reply");
  return out;
}
