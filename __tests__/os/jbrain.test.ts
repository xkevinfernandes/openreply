import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultCalendarSettings } from "../../lib/os/integrations/calendar/settings";
import type { ActiveCalendar } from "../../lib/os/integrations/calendar/store";
import type { CalendarProvider, CalendarSlot } from "../../lib/os/integrations/calendar/types";
import { scriptedBackend, type FakeStep } from "../../lib/os/setter/agent";
import type { FakeView } from "../../lib/os/setter/agent/backends";
import { splitSystemPrompt } from "../../lib/os/setter/agent/trace";
import type { CalendarSource } from "../../lib/os/setter/booking-store";
import { mockTrace } from "../../lib/os/setter/inspect/mock";
import { costOf, priceFor } from "../../lib/os/setter/inspect/prices";
import { actionLabel, argsOf, fmtCost, fmtMs, fmtTokens, groupOf, groupPrompt, shortModel, stepContext, viewFromLegacy, viewFromTrace, windowFrom } from "../../lib/os/setter/inspect/view";
import type { KnowledgeSource, ResolvedSetter } from "../../lib/os/setter/kb";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { sandboxReply } from "../../lib/os/setter/sandbox";
import {
  fakeFieldValues,
  forceLines,
  historyOf,
  labelsOf,
  REALLY_BOOK_CONFIRM,
  reallyBookAllowed,
  stepBlock,
  stepOverrideFrom,
  testLinesFrom,
  type TestLine,
} from "../../lib/os/setter/sandbox-options";
import type { SetterContact } from "../../lib/os/setter/store";
import type { CatalogRow } from "../../lib/os/setter/types";

const NOW = new Date("2026-10-19T08:00:00Z");
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

beforeEach(() => vi.stubEnv("OS_J_TOOLS", "1"));
afterEach(() => vi.unstubAllEnvs());

// ---------------------------------------------------------------- formatting
describe("Inspect formatting", () => {
  it("formats tokens, cost and time with the least text", () => {
    expect(fmtTokens(220)).toBe("220");
    expect(fmtTokens(9_700)).toBe("9.7k");
    expect(fmtTokens(123_456)).toBe("123k");
    expect(fmtTokens(null)).toBe("—");
    expect(fmtCost(0.0142)).toBe("$0.014");
    expect(fmtCost(0.0004)).toBe("<$0.001");
    expect(fmtCost(1.2)).toBe("$1.20");
    expect(fmtCost(null)).toBe("—");
    expect(fmtMs(18)).toBe("18 ms");
    expect(fmtMs(3_180)).toBe("3.2s");
    expect(shortModel("claude-sonnet-5")).toBe("sonnet 5");
    expect(shortModel("claude-opus-5-5")).toBe("opus 5.5");
    expect(shortModel("fake")).toBe("fake");
  });

  it("prices usage from the one table, cache reads at 0.1× and writes at 1.25×", () => {
    expect(costOf("claude-sonnet-5", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(2);
    expect(costOf("claude-sonnet-5", { inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(10);
    expect(costOf("claude-sonnet-5", { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 })).toBeCloseTo(0.2);
    expect(costOf("claude-sonnet-5", { inputTokens: 0, outputTokens: 0, cacheWriteTokens: 1_000_000 })).toBeCloseTo(2.5);
    expect(priceFor("claude-haiku-4-5-20251001")).toEqual(priceFor("claude-haiku-4-5"));
    expect(costOf("fake", { inputTokens: 10, outputTokens: 10 })).toBeNull();
  });

  it("summarises call arguments and actions", () => {
    expect(argsOf("check_calendar", { from: "2026-10-22", to: "2026-10-24", tz: "Europe/London" })).toBe("(2026-10-22–2026-10-24, Europe/London)");
    expect(argsOf("reply", { bubbles: ["a", "b", "c"] })).toBe("(3 bubbles)");
    expect(argsOf("reply", { bubbles: [] })).toBe("(hold)");
    expect(argsOf("send_resource", { slug: "setter-starter" })).toBe("(setter-starter)");
    expect(actionLabel("book_call", { slot: "2026-10-22T14:00:00Z" })).toBe("Book 2026-10-22 14:00");
    expect(actionLabel("send_resource", { slug: "setter-starter" })).toBe("Send setter starter");
    expect(actionLabel("set_field", { key: "niche", value: "coaching" })).toBe("niche = coaching");
  });
});

// ---------------------------------------------------------------- grouping
describe("Inspect prompt grouping", () => {
  it("maps system prompt sections onto the knowledge base groups", () => {
    expect(groupOf("method")).toBe("Method");
    expect(groupOf("brand")).toBe("System prompt");
    expect(groupOf("WHO YOU ARE")).toBe("System prompt");
    expect(groupOf("VOICE EXAMPLES")).toBe("Examples");
    expect(groupOf("Offer")).toBe("Business");
    expect(groupOf("ICP")).toBe("Business");
    expect(groupOf("OFFERS — what can be invited to today")).toBe("Offers");
    expect(groupOf("Objection playbook")).toBe("Objections");
    expect(groupOf("CLIENT JOURNEY")).toBe("Funnel");
    expect(groupOf("RESOURCES")).toBe("Resources");
    expect(groupOf("something new")).toBe("Other");
  });

  it("groups in a fixed order, splits the user prompt into Turn + Thread, and keeps all text", () => {
    const system = "method text\n\n---\n\n## BRAND CONTEXT\n- a\n### Offer\nx\n### VOICE EXAMPLES\nthem: hi\n### Objection playbook\n- y";
    const user = "DRAFT KIND: reply\n\nThe WHOLE conversation so far (1 messages):\nTHEM: hi";
    const g = groupPrompt(splitSystemPrompt(system), user);
    expect(g.map((x) => x.name)).toEqual(["Method", "System prompt", "Business", "Objections", "Examples", "Turn", "Thread"]);
    expect(g.find((x) => x.name === "Thread")?.text).toContain("THEM: hi");
    expect(g.every((x) => x.tokens === Math.ceil(x.text.length / 4))).toBe(true);
  });

  it("reads the window and the step from what J saw", () => {
    expect(windowFrom("… window: free until 2026-10-19 22:00 UTC.", "2026-10-19T08:00:00.000Z")).toBe("free · 14h left");
    expect(windowFrom("… window: closed.", "2026-10-19T08:00:00.000Z")).toBe("closed");
    expect(windowFrom("no window here", "2026-10-19T08:00:00.000Z")).toBeNull();
    expect(stepContext({ goal: "book_call", leadMagnet: { mode: "hold", resources: [{ slug: "s", title: "Starter", released: false }] } })).toEqual({ goal: "Book a call", hold: "Starter · held" });
    expect(stepContext({ goal: "start_conversation", leadMagnet: { mode: "none", resources: [] } })).toEqual({ goal: "Start a conversation", hold: "none" });
  });
});

describe("Inspect views", () => {
  it("builds the five sections from a trace", () => {
    const v = viewFromTrace(mockTrace(NOW), { source: "draft", variantLabels: { "mock-variant-a": "A" }, stage: "qualify" });
    expect(v.legacy).toBe(false);
    expect(v.context).toMatchObject({ goal: "Book a call", hold: "Setter Starter · held", stage: "qualify", window: "free · 14h left" });
    expect(v.context.lines).toEqual([{ key: "permission_ask", variant: "A", text: expect.any(String) }]);
    expect(v.prompt?.groups[0].name).toBe("Method");
    expect(v.tools?.filter((t) => t.used).map((t) => t.name)).toEqual(["get_step", "set_field", "set_stage", "reply"]);
    expect(v.calls?.map((c) => c.ms)).toEqual([18, null, null, 2_700]);
    expect(v.result.actions.map((a) => a.status)).toEqual(["queued", "queued"]);
    expect(v.result).toMatchObject({ tokensIn: 812 + 8_900, cached: 8_900, tokensOut: 220, ms: 3_180, model: "claude-sonnet-5" });
    expect(fmtCost(v.result.cost)).toBe("$0.006");
  });

  it("a sandbox trace marks its actions dry", () => {
    const v = viewFromTrace({ ...mockTrace(NOW), dry: true });
    expect(v.source).toBe("sandbox");
    expect(v.result.actions.every((a) => a.status === "dry")).toBe(true);
  });

  it("a legacy draft shows what it kept", () => {
    const v = viewFromLegacy({ at: NOW.toISOString(), bubbles: ["hey"], reasoning: "r", stage: "value", backend: "anthropic_api", model: "claude-sonnet-5", inputTokens: 1000, outputTokens: 100 });
    expect(v.legacy).toBe(true);
    expect(v.prompt).toBeNull();
    expect(v.calls).toBeNull();
    expect(v.result.cost).toBeCloseTo((1000 * 2 + 100 * 10) / 1e6);
    const bare = { at: NOW.toISOString(), bubbles: [], reasoning: null, stage: null, backend: "fake", model: null, inputTokens: null, outputTokens: null };
    expect(viewFromLegacy(bare).result).toMatchObject({ tokensIn: null, cost: null, hold: true });
    const withPrompt = viewFromLegacy({ ...bare, prompt: { system: "m", user: "window: free until 2026-10-19 10:00 UTC" } });
    expect(withPrompt.prompt?.groups.map((g) => g.name)).toEqual(["Method", "Turn"]);
    expect(withPrompt.context.window).toBe("free · 2h left");
  });
});

// ---------------------------------------------------------------- sandbox options
const TEST: TestLine = {
  experimentId: "e1",
  slot: "line:permission_ask",
  key: "permission_ask",
  name: "permission",
  variants: [
    { id: "va", label: "A", text: "cool if I ask a couple of q's?" },
    { id: "vb", label: "B", text: "mind if I ask you 2 quick things first?" },
  ],
};

describe("Sandbox options", () => {
  it("offers only running in-conversation line tests for this setter", () => {
    const v = [{ id: "v", label: "A", text: "t", weight: 1, active: true }];
    const exps = [
      { id: "e1", slot: "line:permission_ask", name: "p", status: "RUNNING" as const, setterId: null, variants: v },
      { id: "e2", slot: "line:invite", name: "i", status: "PAUSED" as const, setterId: null, variants: v },
      { id: "e3", slot: "j_opener:any", name: "o", status: "RUNNING" as const, setterId: null, variants: v },
      { id: "e4", slot: "line:value_offer", name: "v", status: "RUNNING" as const, setterId: "other", variants: v },
      { id: "e5", slot: "line:follow_up_1", name: "f", status: "RUNNING" as const, setterId: null, variants: v },
    ];
    expect(testLinesFrom(exps, "s1").map((l) => l.experimentId)).toEqual(["e1"]);
  });

  it("forces A, B or random per line, one variant only", () => {
    expect(forceLines([TEST], { e1: "A" }).map((l) => l.variantId)).toEqual(["va"]);
    expect(forceLines([TEST], { e1: "B" }).map((l) => l.variantId)).toEqual(["vb"]);
    expect(forceLines([TEST], { e1: "random" }, () => 0.99).map((l) => l.variantId)).toEqual(["vb"]);
    expect(forceLines([TEST], {}, () => 0).map((l) => l.variantId)).toEqual(["va"]);
    expect(forceLines([TEST], { e1: "A" })[0]).toMatchObject({ key: "permission_ask", slot: "line:permission_ask", forced: false, text: TEST.variants[0].text });
    expect(labelsOf([TEST])).toEqual({ va: "A", vb: "B" });
  });

  it("turns the goal / lead magnet picker into get_step's override", () => {
    const titles = new Map([["setter-starter", "Setter Starter"]]);
    const o = stepOverrideFrom({ goal: "start_conversation", leadMagnet: "hold", resource: "setter-starter" }, titles);
    expect(o).toEqual({ goal: "start_conversation", leadMagnet: { mode: "hold", resources: [{ slug: "setter-starter", title: "Setter Starter", released: false }] } });
    expect(stepBlock(o)).toContain("hold \"Setter Starter\"");
    expect(stepOverrideFrom({ leadMagnet: "none", resource: "setter-starter" }, titles)).toEqual({ goal: "book_call", leadMagnet: { mode: "none", resources: [] } });
    expect(fakeFieldValues({ fields: [{ key: "First name", value: "Sam" }, { key: "Revenue", value: " " }] })).toEqual([{ key: "first_name", label: "First name", value: "Sam", source: "sandbox" }]);
  });

  it("a column's history is the lead turns plus the picked run", () => {
    const run = (b: string[]) => ({ reply: { bubbles: b } });
    expect(
      historyOf([
        { from: "lead", text: "hi" },
        { from: "setter", runs: [run(["one"]), run(["two", "2b"])], pick: 1 },
        { from: "lead", text: "ok" },
        { from: "setter", runs: [run([])], pick: 0 },
      ])
    ).toEqual([
      { from: "lead", text: "hi" },
      { from: "setter", text: "two" },
      { from: "setter", text: "2b" },
      { from: "lead", text: "ok" },
    ]);
  });

  it("Really book needs the switch and the confirmation", () => {
    expect(reallyBookAllowed({})).toBe(false);
    expect(reallyBookAllowed({ reallyBook: true })).toBe(false);
    expect(reallyBookAllowed({ reallyBook: true, confirm: "yes" })).toBe(false);
    expect(reallyBookAllowed({ reallyBook: "true", confirm: REALLY_BOOK_CONFIRM })).toBe(false);
    expect(reallyBookAllowed({ reallyBook: false, confirm: REALLY_BOOK_CONFIRM })).toBe(false);
    expect(reallyBookAllowed({ reallyBook: true, confirm: REALLY_BOOK_CONFIRM })).toBe(true);
  });
});

// ---------------------------------------------------------------- sandbox plumbing
const STARTER: CatalogRow = { slug: "setter-starter", type: "resource", name: "Setter Starter", status: "active", resource_kind: "doc", resource_url: "https://kevin.example/setter-starter", blurb: "The script" };

const knowledge: KnowledgeSource = {
  async forContact(c) {
    const s = await fileKnowledgeSource().forContact(c);
    return { ...s, offered: { ...s.offered, resources: [...s.offered.resources, STARTER] }, catalog: { ...s.catalog, resources: [...s.catalog.resources, STARTER] } } as ResolvedSetter;
  },
  async forSetter() {
    return null;
  },
};
const contact = { id: "c1", workspaceId: "w1", igUserId: "1", username: "sam", conversationId: "x", kind: "SALES", paused: false, tags: [] } as unknown as SetterContact;

function fakeCalendar() {
  const booked: string[] = [];
  const slots: CalendarSlot[] = [];
  for (let t = NOW.getTime(); t < NOW.getTime() + 8 * 86_400_000; t += 1_800_000) slots.push({ start: stamp(new Date(t)), end: null });
  const client: CalendarProvider = {
    id: "calcom",
    verify: async () => ({ name: "K", email: null, timezone: "Europe/Lisbon" }),
    listEventTypes: async () => [],
    getAvailableSlots: async () => slots,
    createBooking: async (_e, slot) => {
      booked.push(slot.start);
      return { kind: "booked", externalId: "x", start: slot.start, end: null, url: null };
    },
  };
  const settings = { ...defaultCalendarSettings(), hostTimezone: "Europe/Lisbon", minNoticeHours: 2, daysAhead: 7, options: 2, directBooking: true };
  const active: ActiveCalendar = { provider: "calcom", client, settings, eventTypeId: "42", eventName: "Intro", durationMinutes: 30 };
  const source: CalendarSource = { forSetter: async () => active, provider: async () => client, noDirectBooking: async () => {} };
  return { source, booked };
}

const suggested = (v: FakeView): string[] => {
  const r = [...v.results].reverse().find((x) => x.name === "check_calendar" && x.ok);
  return ((r?.output as { suggested?: { id: string }[] })?.suggested ?? []).map((s) => s.id);
};

const bookingScript = (): FakeStep[] => [
  [{ name: "check_calendar", input: { tz: "Europe/London" } }],
  (v) => [
    { name: "book_call", input: { slot: suggested(v)[0], email: "lead@x.io" } },
    { name: "reply", input: { bubbles: ["locked in"], lines_used: [], reasoning: "r" } },
  ],
];

describe("Sandbox plumbing", () => {
  it("passes the forced line and the goal override into get_step and the prompt", async () => {
    const setter = await knowledge.forContact(contact);
    const steps: FakeStep[] = [[{ name: "get_step" }], [{ name: "reply", input: { bubbles: ["sure"], lines_used: ["permission_ask"], reasoning: "r" } }]];
    const r = await sandboxReply(setter, [{ from: "lead", text: "hey" }], {
      now: NOW,
      agent: scriptedBackend(steps),
      lines: forceLines([TEST], { e1: "B" }),
      situation: { goal: "start_conversation", leadMagnet: "hold", resource: "setter-starter", fields: [{ key: "First name", value: "Sam" }] },
    });
    const step = r.trace?.calls.find((c) => c.name === "get_step")?.output as { goal: string; leadMagnet: { mode: string; resources: { slug: string }[] }; lines: { variantId: string; text: string }[] };
    expect(step.goal).toBe("start_conversation");
    expect(step.leadMagnet).toMatchObject({ mode: "hold", resources: [{ slug: "setter-starter" }] });
    expect(step.lines.map((l) => l.variantId)).toEqual(["vb"]);
    expect(r.trace?.prompt.user).toContain(TEST.variants[1].text);
    expect(r.trace?.prompt.user).not.toContain(TEST.variants[0].text);
    expect(r.trace?.prompt.user).toContain("STEP: goal: start a conversation");
    expect(r.trace?.lines.used).toEqual(["permission_ask"]);
    const v = viewFromTrace(r.trace!, { variantLabels: labelsOf([TEST]) });
    expect(v.context).toMatchObject({ goal: "Start a conversation", hold: "Setter Starter · held", lines: [{ key: "permission_ask", variant: "B" }] });
  });

  it("without tools the sandbox keeps the prompt, with the forced line in it", async () => {
    vi.stubEnv("OS_J_TOOLS", "");
    const setter = await knowledge.forContact(contact);
    const r = await sandboxReply(setter, [{ from: "lead", text: "hey" }], { now: NOW, lines: forceLines([TEST], { e1: "A" }), situation: { goal: "book_call", leadMagnet: "none", fields: [{ key: "Niche", value: "coaching" }] } });
    expect(r.trace).toBeUndefined();
    expect(r.prompt?.user).toContain(TEST.variants[0].text);
    expect(r.prompt?.user).toContain("Niche: coaching");
    expect(viewFromLegacy({ at: NOW.toISOString(), bubbles: r.bubbles, reasoning: null, stage: null, backend: "fake", model: null, inputTokens: null, outputTokens: null, prompt: r.prompt }).prompt?.groups.length).toBeGreaterThan(1);
  });

  it("books dry by default; Really book needs the confirmation, then books once", async () => {
    const setter = await knowledge.forContact(contact);
    const turn = { from: "lead" as const, text: "yes, London, lead@x.io" };

    const dry = fakeCalendar();
    const r1 = await sandboxReply(setter, [turn], { now: NOW, workspaceId: "w1", calendar: dry.source, agent: scriptedBackend(bookingScript()), reallyBook: true });
    expect(r1.trace?.actions.map((a) => a.name)).toEqual(["book_call"]);
    expect(r1.booked).toBeNull();
    expect(dry.booked).toHaveLength(0);

    const real = fakeCalendar();
    const r2 = await sandboxReply(setter, [turn], { now: NOW, workspaceId: "w1", calendar: real.source, agent: scriptedBackend(bookingScript()), reallyBook: true, confirm: REALLY_BOOK_CONFIRM });
    expect(r2.booked).toMatchObject({ ok: true });
    expect(real.booked).toHaveLength(1);
  });
});
