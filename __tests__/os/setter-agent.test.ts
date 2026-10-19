import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssignmentRow, ExperimentStore, Person } from "../../lib/os/experiments/store";
import { defaultCalendarSettings, type CalendarSettings } from "../../lib/os/integrations/calendar/settings";
import type { ActiveCalendar } from "../../lib/os/integrations/calendar/store";
import type { CalendarProvider, CalendarSlot } from "../../lib/os/integrations/calendar/types";
import { runAgentTurn, scriptedBackend, type AgentEnv, type FakeStep } from "../../lib/os/setter/agent";
import { mapTurn } from "../../lib/os/setter/agent/actions";
import type { FakeView } from "../../lib/os/setter/agent/backends";
import { newTurnState } from "../../lib/os/setter/agent/context";
import { MAX_TOOL_CALLS } from "../../lib/os/setter/agent/tools";
import { isDraftTrace, splitSystemPrompt, type DraftTrace } from "../../lib/os/setter/agent/trace";
import { applyBookingReply, loadBookingContext, readBookingReply } from "../../lib/os/setter/booking";
import type { BookingRecord, BookingStore, CalendarSource } from "../../lib/os/setter/booking-store";
import { getSetterConfig } from "../../lib/os/setter/config";
import type { KnowledgeSource, ResolvedSetter } from "../../lib/os/setter/kb";
import { fileKnowledgeSource, loadMethod } from "../../lib/os/setter/knowledge";
import { buildPrompt, systemPrompt } from "../../lib/os/setter/prompt";
import { sandboxReply } from "../../lib/os/setter/sandbox";
import { approveDraft, draftForContact } from "../../lib/os/setter/service";
import { newRecord, type SetterRecord, type ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";
import type { CatalogRow } from "../../lib/os/setter/types";

// Monday 19 Oct 2026, 08:00 UTC.
const NOW = new Date("2026-10-19T08:00:00Z");
const stamp = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
const mins = (n: number) => new Date(NOW.getTime() + n * 60_000);

const settings: CalendarSettings = {
  ...defaultCalendarSettings(),
  hostTimezone: "Europe/Lisbon",
  minNoticeHours: 2,
  daysAhead: 7,
  options: 2,
  eventTypes: { default: "42" },
  eventTypeInfo: { "42": { name: "Intro call", durationMinutes: 30 } },
};

function weekOfSlots(): CalendarSlot[] {
  const out: CalendarSlot[] = [];
  for (let t = NOW.getTime(); t < NOW.getTime() + 8 * 86_400_000; t += 1_800_000) out.push({ start: stamp(new Date(t)), end: null });
  return out;
}

function fakeCalendar() {
  const booked: { start: string; email: string }[] = [];
  const client: CalendarProvider = {
    id: "calcom",
    verify: async () => ({ name: "Kevin", email: null, timezone: "Europe/Lisbon" }),
    listEventTypes: async () => [{ id: "42", name: "Intro call", durationMinutes: 30 }],
    getAvailableSlots: async () => weekOfSlots(),
    createBooking: async (_e, slot, a) => {
      booked.push({ start: slot.start, email: a.email });
      return { kind: "booked", externalId: `ext-${slot.start}`, start: slot.start, end: null, url: null };
    },
  };
  const active: ActiveCalendar = { provider: "calcom", client, settings: { ...settings, directBooking: true }, eventTypeId: "42", eventName: "Intro call", durationMinutes: 30 };
  const source: CalendarSource = { forSetter: async () => active, provider: async () => client, noDirectBooking: async () => {} };
  return { source, booked, active };
}

function memoryBookings() {
  const rows: (BookingRecord & { draftId: string })[] = [];
  const store: BookingStore = {
    byDraft: async (id) => rows.find((r) => r.draftId === id) ?? null,
    create: async (input) => {
      const r = { ...input, id: `b${rows.length + 1}`, confirmedAt: null };
      rows.push(r);
      return r;
    },
    booked: async () => {},
    confirm: async () => {},
    latest: async (_w, cid) => [...rows].reverse().find((r) => r.contactId === cid) ?? null,
  };
  return { store, rows };
}

function memoryStore(contact: SetterContact, thread: ThreadMessage[]) {
  const states = new Map<string, SetterRecord>();
  const drafts = new Map<string, DraftView & { raw?: unknown; proposedTags?: Record<string, string> }>();
  const sent: string[] = [];
  let seq = 0;
  const store: SetterStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    loadState: async (id) => (states.has(id) ? structuredClone(states.get(id)!) : null),
    saveState: async (c, rec) => void states.set(c.id, structuredClone(rec)),
    pendingDraft: async (id) => [...drafts.values()].find((d) => d.contactId === id && d.status === "PENDING") ?? null,
    createDraft: async (input: NewDraft) => {
      for (const d of drafts.values()) if (d.status === "PENDING") d.status = "DISCARDED";
      const d = { ...input, id: `d${++seq}`, status: "PENDING" as const, createdAt: NOW.toISOString() };
      drafts.set(d.id, d);
      return d;
    },
    getDraft: async (id) => drafts.get(id) ?? null,
    claimDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "APPROVED";
      return true;
    },
    markSent: async (id, s) => void Object.assign(drafts.get(id)!, { status: "SENT", bubbles: s.bubbles }),
    releaseDraft: async (id, error) => void Object.assign(drafts.get(id)!, { status: "PENDING", sendError: error }),
    discardDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "DISCARDED";
      return true;
    },
    listPending: async () => [...drafts.values()].filter((d) => d.status === "PENDING"),
    send: async (_c, text) => {
      sent.push(text);
      thread.push({ id: `out${sent.length}`, text, incoming: false, at: stamp(new Date(NOW.getTime() + sent.length * 1000)) });
    },
    setSetterStage: async () => {},
  };
  return { store, states, drafts, sent };
}

/** A tiny experiment store: one running test on the permission ask. */
function oneLineTest(): ExperimentStore {
  const rows: AssignmentRow[] = [];
  const exp = {
    id: "e1",
    workspaceId: "w1",
    setterId: null,
    name: "permission",
    slot: "line:permission_ask",
    status: "RUNNING" as const,
    allocation: "EVEN" as const,
    variants: [
      { id: "va", label: "A", text: "cool if I ask a couple of q's?", weight: 1, active: true },
      { id: "vb", label: "B", text: "mind if I ask you 2 quick things first?", weight: 1, active: true },
    ],
  };
  const find = (id: string, p: Person) => rows.find((a) => a.experimentId === id && a.igUserId === p.igUserId) ?? null;
  return {
    running: async (_w: string, slots: string[]) => (slots.includes(exp.slot) ? [exp] : []),
    findAssignment: async (id: string, p: Person) => find(id, p),
    createAssignment: async (experimentId: string, variantId: string, p: Person) => {
      const r = { id: "a1", experimentId, variantId, instagramAccountId: p.instagramAccountId, igUserId: p.igUserId, contactId: null, assignedAt: NOW, sentAt: null, draftId: null, edited: false };
      rows.push(r);
      return r;
    },
    markSent: async () => {},
    get: async () => null,
  } as unknown as ExperimentStore;
}

const STARTER: CatalogRow = {
  slug: "setter-starter",
  type: "resource",
  name: "Setter Starter",
  status: "active",
  resource_kind: "doc",
  resource_url: "https://kevin.example/setter-starter",
  blurb: "The 6-stage setting script",
};

/** The file knowledge base plus one lead magnet and two Fields J fills. */
const knowledge: KnowledgeSource = {
  async forContact(c) {
    return withExtras(await fileKnowledgeSource().forContact(c));
  },
  async forSetter(w, s) {
    const r = await fileKnowledgeSource().forSetter(w, s);
    return r && withExtras(r);
  },
};
function withExtras(s: ResolvedSetter): ResolvedSetter {
  return {
    ...s,
    profile: { ...s.profile, fields: [{ key: "niche", label: "Niche", type: "TEXT" }, { key: "pain", label: "Pain", type: "TEXT" }] },
    offered: { ...s.offered, resources: [...s.offered.resources, STARTER] },
    catalog: { ...s.catalog, resources: [...s.catalog.resources, STARTER] },
  };
}

const contact: SetterContact = {
  id: "c1",
  workspaceId: "w1",
  igUserId: "101",
  username: "sam",
  conversationId: "conv1",
  kind: "SALES",
  paused: false,
  tags: [],
  fullName: "Sam Ortega",
  stage: "CALL_OFFERED",
  setterStage: "bridge",
};

let t = 0;
const said = (text: string, at: Date = new Date(NOW.getTime() - 300_000)): ThreadMessage => ({ id: `in${++t}`, text, incoming: true, at: stamp(at) });

/** The ids check_calendar suggested, from the fake's view. */
const suggested = (v: FakeView): string[] => {
  const r = [...v.results].reverse().find((x) => x.name === "check_calendar" && x.ok);
  return ((r?.output as { suggested?: { id: string }[] })?.suggested ?? []).map((s) => s.id);
};
const traceOf = (d: DraftView): DraftTrace => {
  const raw = (d as DraftView & { raw?: { trace?: unknown } }).raw;
  expect(isDraftTrace(raw?.trace)).toBe(true);
  return raw!.trace as DraftTrace;
};

beforeEach(() => {
  t = 0;
  vi.stubEnv("OS_J_TOOLS", "1");
});
afterEach(() => vi.unstubAllEnvs());

describe("J with tools: booking in the DM", () => {
  it("check_calendar → two times → pick → book_call + send_resource → one booking draft, one Approve", async () => {
    const thread: ThreadMessage[] = [said("yes let's do a call, I'm in NYC")];
    const mem = memoryStore(contact, thread);
    const cal = fakeCalendar();
    const bk = memoryBookings();
    let offered: string[] = [];

    // Turn 1: look at the calendar, offer two times.
    const turn1: FakeStep[] = [
      [{ name: "check_calendar", input: { tz: "America/New_York" } }],
      (v) => {
        offered = suggested(v);
        return [{ name: "reply", input: { bubbles: ["bet, would either of these work? (your time)"], lines_used: [], reasoning: "they said yes", offered_slots: offered } }];
      },
    ];
    const deps = { store: mem.store, knowledge, calendar: cal.source, bookings: bk.store, fieldValues: null };
    const r1 = await draftForContact("c1", { ...deps, now: NOW, agent: scriptedBackend(turn1) });
    expect(r1.status).toBe("drafted");
    const d1 = (r1 as { draft: DraftView }).draft;
    expect(d1.kind).toBe("reply");
    expect(offered).toHaveLength(2);
    const tr1 = traceOf(d1);
    expect(tr1.calls.map((c) => c.name)).toEqual(["check_calendar", "reply"]);
    expect(tr1.tools.map((x) => x.name)).toContain("book_call");
    expect(await approveDraft(d1.id, "w1", { ...deps, now: () => NOW, gapMs: 0 })).toEqual({});
    const proposed = mem.states.get("c1")!.booking!;
    expect(proposed).toMatchObject({ phase: "proposed", proposed: offered, timezone: "America/New_York" });

    // Turn 2: they pick the first, with their email. Re-check, book, confirm, release the doc.
    thread.push(said("the first one works, my email is sam@ortega.io", mins(30)));
    const at = mins(60);
    const recBefore = structuredClone(mem.states.get("c1")!);
    const turn2: FakeStep[] = [
      [{ name: "check_calendar", input: { tz: "America/New_York" } }],
      (v) => {
        const ids = [...v.results].reverse().find((x) => x.name === "check_calendar")!;
        const all = [...((ids.output as { suggested: { id: string }[] }).suggested ?? []), ...((ids.output as { more: { id: string }[] }).more ?? [])].map((x) => x.id);
        expect(all).toContain(offered[0]);
        return [
          { name: "book_call", input: { slot: offered[0], email: "sam@ortega.io", name: "Sam Ortega" } },
          { name: "send_resource", input: { slug: "setter-starter" } },
        ];
      },
      [{ name: "reply", input: { bubbles: ["locked in, invite's on its way", "once it lands can you send me a screenshot?"], lines_used: [], reasoning: "booked" } }],
    ];
    const r2 = await draftForContact("c1", { ...deps, now: at, agent: scriptedBackend(turn2) });
    expect(r2.status).toBe("drafted");
    const d = (r2 as { draft: DraftView }).draft;
    expect(d.kind).toBe("booking");
    expect(d.flags).toContain("booking");
    expect(d.setterStage).not.toBe("booked");
    // The link is its own bubble, after the confirmation.
    expect(d.bubbles).toEqual(["locked in, invite's on its way", "once it lands can you send me a screenshot?", STARTER.resource_url]);

    // Exactly what the legacy booking path makes for the same time and email.
    const ctx = (await loadBookingContext(cal.active, recBefore, thread, at))!;
    const legacy = applyBookingReply(readBookingReply({ action: "confirm", slot: offered[0], email: "sam@ortega.io" }), ctx, recBefore, contact, ["x"], at);
    expect(d.booking).toEqual(legacy.payload);

    const tr = traceOf(d);
    expect(tr.calls.map((c) => c.name)).toEqual(["check_calendar", "book_call", "send_resource", "reply"]);
    expect(tr.actions.map((a) => [a.name, a.status])).toEqual([
      ["book_call", "queued"],
      ["send_resource", "queued"],
    ]);
    expect(tr.reply?.bubbles).toEqual(d.bubbles);
    expect(tr.model).toBe("fake");
    expect(tr.prompt.system.length).toBeGreaterThan(1);
    expect(tr.prompt.user).toContain("HOW TO ANSWER: you have tools");
    expect(tr.prompt.user).not.toContain("STRICT JSON");

    // Drafting never books; Approve books then sends.
    expect(cal.booked).toHaveLength(0);
    expect(await approveDraft(d.id, "w1", { ...deps, now: () => at, gapMs: 0 })).toEqual({});
    expect(cal.booked).toEqual([{ start: offered[0], email: "sam@ortega.io" }]);
    expect(bk.rows[0]).toMatchObject({ status: "BOOKED", draftId: d.id });
    expect(mem.sent.slice(-3)).toEqual(d.bubbles);
    expect(mem.states.get("c1")!.booking).toMatchObject({ phase: "booked", start: offered[0] });
  });
});

describe("J with tools: the server's rules", () => {
  it("rejects actions outside the rules, each action once, and links in bubbles", async () => {
    const thread: ThreadMessage[] = [said("I coach dentists, stuck at 5k a month")];
    const mem = memoryStore({ ...contact, stage: "IN_CONVERSATION", setterStage: "qualify" }, thread);
    const steps: FakeStep[] = [
      [
        { name: "book_call", input: { slot: "2026-10-20T15:00:00Z", email: "a@b.co" } },
        { name: "set_field", input: { key: "bogus", value: "x" } },
        { name: "set_field", input: { key: "niche", value: "dentists" } },
        { name: "send_resource", input: { slug: "nope" } },
        { name: "add_tag", input: { tag: "weird", reason: "x" } },
        { name: "set_stage", input: { stage: "qualify" } },
        { name: "set_stage", input: { stage: "value" } },
      ],
      [{ name: "reply", input: { bubbles: ["dentists, nice", "here: https://evil.example/x"], lines_used: [], reasoning: "r" } }],
      [{ name: "reply", input: { bubbles: ["dentists, nice", "what's the main thing in the way of 10k?"], lines_used: ["made_up"], reasoning: "r" } }],
    ];
    const r = await draftForContact("c1", { store: mem.store, knowledge, calendar: fakeCalendar().source, bookings: memoryBookings().store, fieldValues: null, now: NOW, agent: scriptedBackend(steps) });
    expect(r.status).toBe("drafted");
    const d = (r as { draft: DraftView }).draft;
    const tr = traceOf(d);
    expect(tr.actions.filter((a) => a.status === "rejected").map((a) => a.name)).toEqual(["book_call", "set_field", "send_resource", "add_tag", "set_stage"]);
    expect(tr.actions.find((a) => a.name === "book_call")!.reason).toMatch(/check_calendar/);
    expect(tr.actions.filter((a) => a.status === "queued").map((a) => a.name)).toEqual(["set_field", "set_stage"]);
    // The reply with a link was sent back once; the second reply went through.
    expect(tr.calls.filter((c) => c.name === "reply").map((c) => c.ok)).toEqual([false, true]);
    expect(d.bubbles).toEqual(["dentists, nice", "what's the main thing in the way of 10k?"]);
    expect(d.kind).toBe("reply");
    expect(d.setterStage).toBe("qualify");
    expect(tr.lines.used).toEqual([]);
    expect(tr.notes.join(" ")).toMatch(/made_up/);
    // Field capture reads Draft.raw.fields, as before.
    expect((d as DraftView & { raw: { fields: unknown } }).raw.fields).toEqual({ niche: "dentists" });
  });

  it(`caps a turn at ${MAX_TOOL_CALLS} tool calls, then only reply is offered`, async () => {
    const thread: ThreadMessage[] = [said("hey what do you do")];
    const mem = memoryStore(contact, thread);
    let lastTools: string[] = [];
    const steps: FakeStep[] = [
      Array.from({ length: 10 }, () => ({ name: "get_contact" })),
      (v) => {
        lastTools = v.tools;
        return [{ name: "reply", input: { bubbles: ["ha I help people set in their DMs"], lines_used: [], reasoning: "r" } }];
      },
    ];
    const r = await draftForContact("c1", { store: mem.store, knowledge, calendar: fakeCalendar().source, bookings: memoryBookings().store, fieldValues: null, now: NOW, agent: scriptedBackend(steps) });
    const tr = traceOf((r as { draft: DraftView }).draft);
    expect(lastTools).toEqual(["reply"]);
    expect(tr.forcedReply).toBe(true);
    expect(tr.calls.filter((c) => c.name === "get_contact" && c.ok)).toHaveLength(MAX_TOOL_CALLS);
    expect(tr.calls.filter((c) => c.name === "get_contact" && !c.ok).map((c) => c.summary)[0]).toMatch(/Tool limit/);
    expect(tr.usage.requests).toBe(2);
  });

  it("a paused contact or a closed window drops every action; hand_to_kevin flags the draft", async () => {
    const setter = await knowledge.forContact(contact);
    const rec = newRecord("conv1", "sam");
    const env = (over: Partial<AgentEnv> = {}): AgentEnv => ({
      now: NOW,
      contact: { id: "c1", username: "sam", tags: [], paused: false },
      rec,
      msgs: [said("refund please")],
      setter,
      windowClosed: false,
      calendar: null,
      lines: [],
      dry: false,
      ...over,
    });
    const queued = [
      { name: "hand_to_kevin" as const, input: { reason: "refund" } },
      { name: "add_tag" as const, input: { tag: "not_now", reason: "refund" } },
    ];
    const reply = { bubbles: ["let me check with the team"], linesUsed: [], reasoning: null, offeredSlots: [], pickedSlot: null, holdReason: null, invite: null, fitScore: null };
    const live = mapTurn(env(), newTurnState(), queued, [], reply);
    expect(live.flags).toEqual(["hand_to_kevin"]);
    expect(live.obj.propose_tags).toEqual({ not_now: "refund" });
    for (const e of [env({ contact: { id: "c1", username: "sam", tags: [], paused: true } }), env({ windowClosed: true })]) {
      const out = mapTurn(e, newTurnState(), queued, [], reply);
      expect(out.actions.every((a) => a.status === "dropped")).toBe(true);
      expect(out.flags).toEqual([]);
      expect(out.obj.propose_tags).toEqual({});
      expect(out.obj.bubbles).toEqual(["let me check with the team"]);
    }
  });

  it("get_step carries only this contact's assigned test line", async () => {
    const thread: ThreadMessage[] = [said("I run a small agency"), { id: "o1", text: "nice, how long have you been at it?", incoming: false, at: stamp(mins(-4)) }, said("2 years", mins(-3))];
    const mem = memoryStore({ ...contact, stage: "IN_CONVERSATION", setterStage: "qualify" }, thread);
    let step: { lines: { label: string; text: string; variantId: string }[]; goal: string } | null = null;
    const steps: FakeStep[] = [
      [{ name: "get_step" }],
      (v) => {
        step = v.results[0].output as typeof step;
        return [{ name: "reply", input: { bubbles: [step!.lines[0].text], lines_used: ["permission_ask"], reasoning: "r" } }];
      },
    ];
    const r = await draftForContact("c1", { store: mem.store, knowledge, calendar: fakeCalendar().source, bookings: memoryBookings().store, fieldValues: null, now: NOW, agent: scriptedBackend(steps), experiments: oneLineTest() });
    const d = (r as { draft: DraftView }).draft;
    expect(step!.goal).toBe("book_call");
    expect(step!.lines).toHaveLength(1);
    expect(["va", "vb"]).toContain(step!.lines[0].variantId);
    const tr = traceOf(d);
    expect(tr.lines.assigned).toHaveLength(1);
    expect(tr.lines.used).toEqual(["permission_ask"]);
    expect(d.abVariants).toEqual([expect.objectContaining({ variantId: step!.lines[0].variantId, used: true })]);
    expect(tr.prompt.user).toContain(step!.lines[0].text);
  });
});

describe("J with tools: switch and sandbox", () => {
  it("flag off = the legacy path, byte for byte (no trace, the script is never asked)", async () => {
    vi.stubEnv("OS_J_TOOLS", "");
    const run = async (agent: ReturnType<typeof scriptedBackend> | undefined) => {
      t = 0;
      const thread: ThreadMessage[] = [said("hey man how do you build these agents?")];
      const mem = memoryStore(contact, thread);
      const r = await draftForContact("c1", { store: mem.store, knowledge, calendar: fakeCalendar().source, bookings: memoryBookings().store, now: NOW, agent });
      return (r as unknown as { draft: DraftView & { raw: unknown } }).draft;
    };
    const asked = vi.fn((): { name: string }[] => [{ name: "reply" }]);
    const withScript = await run(scriptedBackend([asked]));
    const without = await run(undefined);
    expect(asked).not.toHaveBeenCalled();
    expect(withScript).toEqual(without);
    expect((without.raw as { trace?: unknown }).trace).toBeUndefined();

    // buildPrompt without an answer format is the legacy prompt.
    const setter = await knowledge.forContact(contact);
    const rec = newRecord("conv1", "sam");
    const msgs = [said("hi")];
    const action = { kind: "reply" as const, anchor: "x", human_agent: false };
    expect(buildPrompt(rec, msgs, action, setter.catalog, NOW, [], undefined)).toBe(buildPrompt(rec, msgs, action, setter.catalog, NOW));
  });

  it("with no script, the fake plays the legacy canned reply through the tools", async () => {
    const thread: ThreadMessage[] = [said("hey man how do you build these agents?")];
    const mem = memoryStore(contact, thread);
    const r = await draftForContact("c1", { store: mem.store, knowledge, calendar: fakeCalendar().source, bookings: memoryBookings().store, fieldValues: null, now: NOW });
    const d = (r as { draft: DraftView }).draft;
    expect(d.flags).toContain("sample");
    expect(d.bubbles.length).toBeGreaterThan(0);
    expect(traceOf(d).calls.map((c) => c.name)).toEqual(["set_stage", "reply"]);
  });

  it("the sandbox runs the tools dry: actions recorded, nothing booked", async () => {
    const setter = await knowledge.forContact(contact);
    const cal = fakeCalendar();
    const steps: FakeStep[] = [
      [{ name: "check_calendar", input: { tz: "Europe/London" } }],
      (v) => [
        { name: "book_call", input: { slot: suggested(v)[0], email: "lead@x.io" } },
        { name: "set_field", input: { key: "niche", value: "coaches" } },
        { name: "send_resource", input: { slug: "setter-starter" } },
        { name: "reply", input: { bubbles: ["locked in"], lines_used: [], reasoning: "r" } },
      ],
    ];
    const r = await sandboxReply(setter, [{ from: "lead", text: "yes, I'm in London, lead@x.io" }], { now: NOW, workspaceId: "w1", calendar: cal.source, agent: scriptedBackend(steps) });
    expect(r.trace?.dry).toBe(true);
    expect(r.trace?.actions.map((a) => a.status)).toEqual(["queued", "queued", "queued"]);
    expect(r.trace?.calls.find((c) => c.name === "book_call")?.summary).toBe("recorded (sandbox)");
    expect(r.bubbles).toEqual(["locked in", STARTER.resource_url]);
    expect(cal.booked).toHaveLength(0);
  });

  it("splits the system prompt into named sections, losslessly", async () => {
    const setter = await knowledge.forContact(contact);
    const system = systemPrompt(loadMethod(), setter.profile, setter.offered, "2026-10-19");
    const parts = splitSystemPrompt(system);
    expect(parts[0].name).toBe("method");
    expect(parts.map((p) => p.text).join("")).toBe(system);
    expect(parts.map((p) => p.name)).toContain("RESOURCES");
    expect(parts.every((p) => p.tokens === Math.ceil(p.chars / 4))).toBe(true);
    // the default config keeps Sonnet for drafts
    expect(getSetterConfig().drafter.models.draft).toBe("claude-sonnet-5");
  });

  it("a real turn needs a model request", async () => {
    const setter = await knowledge.forContact(contact);
    const env: AgentEnv = { now: NOW, contact: { id: "c1", username: "sam", tags: [], paused: false }, rec: newRecord("c", "sam"), msgs: [said("hi")], setter, windowClosed: false, calendar: null, lines: [], dry: true };
    const turn = await runAgentTurn({ system: "s", prompt: "p", env, backend: scriptedBackend([]), settings: getSetterConfig().drafter });
    expect(turn.obj.hold).toBe(true);
    expect(turn.trace.tools.map((x) => x.name)).not.toContain("book_call");
  });
});
