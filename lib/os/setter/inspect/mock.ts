// OS_MOCK: a sample DraftTrace for Maya's seeded draft, so the Inspect drawer
// has something real-shaped to show without a model key.

import { MAYA_DRAFT } from "@/lib/os/mock";
import { estimateTokens, splitSystemPrompt, TRACE_VERSION, type DraftTrace } from "@/lib/os/setter/agent/trace";

const SYSTEM = [
  "You are the DM setter. Six stages: opener, value, permission, qualify, bridge, booked. Match their energy; questions are optional; holding is valid.\n".repeat(30),
  "\n\n---\n\n## BRAND CONTEXT (supplied at runtime — this is the account you are writing for)\n- **Account:** @claudepreneur\n",
  "### WHO YOU ARE\nKevin. Builds Claude Code setters for creators.\n",
  "### Offer\nDone-with-you Claude Code DM setter.\n",
  "### ICP (who we serve)\nCreators with 20+ DMs a week.\n",
  "### Objection playbook\n- **too expensive** → it pays for itself at one call a week.\n",
  "### CLIENT JOURNEY (what to ask at each stage)\n- qualify: what's the business, how many DMs, what's in the way\n",
  "### VOICE EXAMPLES\n" + "THEM: how does it work\nYOU: honestly it's just claude reading your DMs and drafting, you approve\n".repeat(20),
  "### RESOURCES (the ONLY other links that exist — never invent one)\n- **Setter Starter** (guide, slug `setter-starter`)\n",
].join("\n");

const USER = [
  "Conversation with @maya.builds on Instagram.",
  "DRAFT KIND: reply",
  "How they arrived: setter_comment (keyword 'SETTER'). Current state: qualify. window: free until {until} UTC.",
  "A/B LINES (Kevin is testing these words).\n- permission_ask: only if you ask permission in this draft, use this line for it: \"cool if I ask a couple of q's to see if I can actually help?\"",
  "The WHOLE conversation so far (4 messages), oldest first:\nTHEM: SETTER\nYOU: hey Maya! caught your comment\nTHEM: like 40-60 on a good week, most are the same two questions\nTHEM: [voice note] it eats my mornings",
].join("\n\n");

export function mockTrace(now = new Date()): DraftTrace {
  const until = new Date(now.getTime() + 14 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");
  const user = USER.replace("{until}", until);
  const system = splitSystemPrompt(SYSTEM);
  return {
    version: TRACE_VERSION,
    mode: "tools",
    dry: false,
    startedAt: new Date(now.getTime() - 60_000).toISOString(),
    ms: 3_180,
    backend: "anthropic_api",
    model: "claude-sonnet-5",
    usage: { requests: 2, inputTokens: 812, outputTokens: 220, cacheReadTokens: 8_900, cacheWriteTokens: 0 },
    prompt: { system, systemTokens: system.reduce((n, s) => n + s.tokens, 0), user, userTokens: estimateTokens(user) },
    tools: ["get_contact", "get_step", "check_calendar", "get_resource", "search_knowledge", "send_resource", "set_field", "add_tag", "set_stage", "exit_step", "hand_to_kevin", "reply"].map((name) => ({
      name,
      kind: name === "reply" ? ("reply" as const) : ["send_resource", "set_field", "add_tag", "set_stage", "exit_step", "hand_to_kevin"].includes(name) ? ("action" as const) : ("read" as const),
    })),
    calls: [
      {
        n: 1,
        name: "get_step",
        kind: "read",
        input: {},
        summary: "goal book_call, 1 test line",
        output: { goal: "book_call", leadMagnet: { mode: "hold", resources: [{ slug: "setter-starter", title: "Setter Starter", released: false }] }, releaseRules: [], exits: ["not_a_fit", "stopped", "goal_met"], lines: [] },
        ok: true,
        ms: 18,
      },
      { n: 2, name: "set_field", kind: "action", input: { key: "dm_volume", value: "40-60 a week" }, summary: "queued", ok: true, ms: 1 },
      { n: 3, name: "set_stage", kind: "action", input: { stage: "qualify" }, summary: "queued", ok: true, ms: 0 },
      { n: 4, name: "reply", kind: "reply", input: { bubbles: MAYA_DRAFT.bubbles, lines_used: [] }, summary: "2 bubbles", ok: true, ms: 2_700 },
    ],
    lines: { assigned: [{ slot: "line:permission_ask", variantId: "mock-variant-a", label: "permission_ask", text: "cool if I ask a couple of q's to see if I can actually help?" }], used: [] },
    actions: [
      { name: "set_field", input: { key: "dm_volume", value: "40-60 a week" }, status: "queued" },
      { name: "set_stage", input: { stage: "qualify" }, status: "queued" },
    ],
    reply: { bubbles: MAYA_DRAFT.bubbles, reasoning: MAYA_DRAFT.reasoning, hold: false },
    forcedReply: false,
    notes: [],
  };
}

export const MOCK_VARIANT_LABELS: Record<string, string> = { "mock-variant-a": "A" };
