import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseCalcomEvent, parseCalendlyEvent, verifyCalcomSignature, verifyCalendlySignature } from "../../lib/os/sequences/calendar-events";
import { deliverStep, nurturePick } from "../../lib/os/sequences/deliver";
import { cancelSequence, markAttendance, skipStep, syncFollowups } from "../../lib/os/sequences/engine";
import { noReplyKeyFor, planFollowup, preCallTimeline, STOPPED, type PlanBooking, type PlanInput, type StepHistory } from "../../lib/os/sequences/plan";
import { memorySequenceStore } from "../../lib/os/sequences/store";
import { addDays, zonedTimeToUtc } from "../../lib/os/sequences/time";
import { cleanSequence, defaultSequenceSet, resolveSequenceSet, type SequenceSet } from "../../lib/os/sequences/types";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { iso, newRecord, type SetterRecord, type ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";

const NOW = new Date("2026-10-21T12:00:00Z"); // Wednesday
const h = (hours: number, from = NOW) => iso(new Date(from.getTime() + hours * 3600_000))!;

function rec(over: Partial<SetterRecord> = {}): SetterRecord {
  return { ...newRecord("conv", "sam", "c1"), state: "in_conversation", their_last_at: h(-3), our_last_at: h(-2), ...over };
}

function input(over: Partial<PlanInput> = {}): PlanInput {
  return {
    now: NOW,
    contact: { kind: "SALES", paused: false, followupsOff: false, tags: [], setterStage: "qualify" },
    rec: rec(),
    booking: null,
    sequences: defaultSequenceSet(),
    history: [],
    ...over,
  };
}

function booking(over: Partial<PlanBooking> = {}): PlanBooking {
  return {
    id: "b1",
    start: "2026-10-23T15:00:00Z", // Friday 4pm London (BST)
    end: "2026-10-23T15:30:00Z",
    timezone: "Europe/London",
    status: "CONFIRMED",
    attendance: null,
    createdAt: h(-1),
    ...over,
  };
}

const done = (key: string, sequence: string, episode: string, stepId: string, doneAt: string, status: StepHistory["status"] = "SENT", reason: string | null = null): StepHistory => ({
  key,
  sequence,
  episode,
  stepId,
  status,
  reason,
  doneAt,
});

// ---------------------------------------------------------------- time
describe("timezone math", () => {
  it("turns a wall-clock time in a timezone into UTC, both sides of DST", () => {
    expect(zonedTimeToUtc("2026-10-22", "17:00", "Europe/London").toISOString()).toBe("2026-10-22T16:00:00.000Z"); // BST
    expect(zonedTimeToUtc("2026-10-26", "17:00", "Europe/London").toISOString()).toBe("2026-10-26T17:00:00.000Z"); // GMT, after the switch
    expect(zonedTimeToUtc("2026-11-02", "09:00", "America/New_York").toISOString()).toBe("2026-11-02T14:00:00.000Z"); // EST
    expect(zonedTimeToUtc("2026-10-22", "09:00", "Asia/Kolkata").toISOString()).toBe("2026-10-22T03:30:00.000Z");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });

  it("puts the day-before reminder on THEIR calendar, not ours", () => {
    // A 1am Saturday call in Sydney is Friday afternoon in London: their "day before" is Friday.
    const b = booking({ start: "2026-10-23T14:00:00Z", timezone: "Australia/Sydney", createdAt: "2026-10-19T10:00:00Z" });
    const steps = defaultSequenceSet().pre_call.steps;
    const t = preCallTimeline(steps, b);
    const dayBefore = t.find((e) => e.step.id === "day-before")!;
    // Call: Sat 24 Oct 01:00 Sydney (AEDT, UTC+11) → day before = Fri 23 Oct 17:00 Sydney = 06:00 UTC.
    expect(dayBefore.dueAt.toISOString()).toBe("2026-10-23T06:00:00.000Z");
    const dayOf = t.find((e) => e.step.id === "day-of")!;
    expect(dayOf.dueAt.toISOString()).toBe("2026-10-23T12:00:00.000Z"); // 2h before
  });
});

// ---------------------------------------------------------------- pre-call
describe("before the call", () => {
  it("plans nurture, the day before and the day of, relative to the booking", () => {
    const t = preCallTimeline(defaultSequenceSet().pre_call.steps, booking({ createdAt: h(0) }));
    const by = Object.fromEntries(t.map((e) => [e.step.id, e]));
    expect(iso(by["nurture-1"].dueAt)).toBe(h(2)); // booked now + 2h
    expect(by["day-before"].dueAt.toISOString()).toBe("2026-10-22T16:00:00.000Z"); // Thu 17:00 London
    expect(by["day-of"].dueAt.toISOString()).toBe("2026-10-23T13:00:00.000Z");
    expect(by["day-before"].dropped).toBeNull();
    // The second nurture (+26h = Thu 14:00 UTC) lands within 3h of the day-before reminder (16:00 UTC).
    expect(by["nurture-2"].dropped).toBe("too close to a reminder");
  });

  it("drops the day-before reminder when they booked the same evening", () => {
    const b = booking({ start: "2026-10-22T09:00:00Z", createdAt: "2026-10-21T21:00:00Z" });
    const t = preCallTimeline(defaultSequenceSet().pre_call.steps, b);
    expect(t.find((e) => e.step.id === "day-before")!.dropped).toBe("booked too close to the call");
    expect(t.find((e) => e.step.id === "nurture-1")!.dropped).toBe("call too soon for a nurture piece");
    expect(t.find((e) => e.step.id === "day-of")!.dropped).toBeNull();
  });

  it("queues the next step not sent yet, skipping missed ones", () => {
    const b = booking({ createdAt: h(-30) });
    const first = planFollowup(input({ booking: b }));
    // nurture-1 was due 28h ago and nurture-2 4h ago: nurture-1 is missed, nurture-2 goes now.
    expect(first.plan?.step.id).toBe("nurture-2");
    const later = planFollowup(input({ booking: b, now: new Date("2026-10-22T16:30:00Z") }));
    expect(later.plan?.step.id).toBe("day-before");
    const sent = planFollowup(input({ booking: b, now: new Date("2026-10-22T16:30:00Z"), history: [done(later.plan!.key, "pre_call", "b1", "day-before", "2026-10-22T16:31:00Z")] }));
    expect(sent.plan?.step.id).toBe("day-of");
  });

  it("a reschedule re-plans the reminders under a new key, a cancel stops them", () => {
    const a = planFollowup(input({ booking: booking({ createdAt: h(-30) }), now: new Date("2026-10-22T16:30:00Z") })).plan!;
    const moved = planFollowup(input({ booking: booking({ createdAt: h(-30), start: "2026-10-27T15:00:00Z" }), now: new Date("2026-10-22T16:30:00Z") })).plan!;
    expect(moved.key).not.toBe(a.key);
    expect(moved.dueAt).not.toBe(a.dueAt);
    const cancelled = planFollowup(input({ booking: booking({ status: "CANCELLED", cancelledAt: h(0) }) }));
    expect(cancelled.plan).toBeNull();
  });

  it("stops for the booking when Kevin cancels the sequence", () => {
    const r = planFollowup(input({ booking: booking(), history: [done("x", "pre_call", "b1", "nurture-1", h(0), "CANCELLED", STOPPED)] }));
    expect(r.plan).toBeNull();
  });
});

// ---------------------------------------------------------------- no reply
describe("no reply", () => {
  it("picks the sequence for the stage they went quiet in", () => {
    expect(noReplyKeyFor(rec({ stage: null }))).toBe("no_reply_lead");
    expect(noReplyKeyFor(rec({ stage: "qualify" }))).toBe("no_reply_qualifying");
    expect(noReplyKeyFor(rec({ stage: null, delivered_at: h(-5) }))).toBe("no_reply_value");
    expect(noReplyKeyFor(rec({ invited: { route: "call", at: h(-5) } }))).toBe("no_reply_invite");
  });

  it("starts with value first, counted from our last message", () => {
    const r = planFollowup(input());
    expect(r.plan?.sequence).toBe("no_reply_qualifying");
    expect(r.plan?.step.id).toBe("value");
    expect(r.plan?.dueAt).toBe(h(18)); // our last 2h ago + 20h
  });

  it("stops the moment they reply", () => {
    const r = planFollowup(input({ rec: rec({ their_last_at: h(-1), our_last_at: h(-2) }) }));
    expect(r.plan).toBeNull();
    expect(r.why).toMatch(/wrote last/);
  });

  it("their reply starts a new episode: the next silence starts at step 1", () => {
    const first = planFollowup(input()).plan!;
    const history = [done(first.key, first.sequence, first.episode, "value", h(18))];
    const step2 = planFollowup(input({ now: new Date(h(19)), history })).plan!;
    expect(step2.step.id).toBe("proof");
    expect(step2.dueAt).toBe(h(18 + 48));
    // They replied, J answered, they went quiet again.
    const again = planFollowup(input({ now: new Date(h(30)), history, rec: rec({ their_last_at: h(25), our_last_at: h(26) }) })).plan!;
    expect(again.step.id).toBe("value");
    expect(again.episode).not.toBe(first.episode);
  });

  it("squeezes the breakup in before Instagram's 7-day window closes, else ends", () => {
    const seq = cleanSequence("no_reply_qualifying", {
      enabled: true,
      steps: [
        { id: "a", label: "A", timing: { kind: "after", minutes: 60 * 24 * 5 } },
        { id: "b", label: "B", timing: { kind: "after", minutes: 60 * 24 * 3 } },
      ],
    });
    const set: SequenceSet = { ...defaultSequenceSet(), no_reply_qualifying: seq };
    const a = planFollowup(input({ sequences: set })).plan!;
    expect(a.dueAt).toBe(h(-2 + 120));
    const b = planFollowup(input({ sequences: set, now: new Date(h(119)), history: [done(a.key, a.sequence, a.episode, "a", h(118))] })).plan!;
    // their last (-3h) + 7d - 1h safety - 2h margin = +162h
    expect(b.dueAt).toBe(h(-3 + 168 - 1 - 2));
    const none = planFollowup(input({ sequences: set, now: new Date(h(162)), history: [done(a.key, a.sequence, a.episode, "a", h(160))] }));
    expect(none.plan).toBeNull();
    expect(none.why).toMatch(/7-day window/);
  });

  it("respects the switches: setter off, thread off, paused, personal, not now", () => {
    const off = { ...defaultSequenceSet(), no_reply_qualifying: { ...defaultSequenceSet().no_reply_qualifying, enabled: false } };
    expect(planFollowup(input({ sequences: off })).plan).toBeNull();
    expect(planFollowup(input({ contact: { kind: "SALES", paused: false, followupsOff: true, tags: [] } })).plan).toBeNull();
    expect(planFollowup(input({ contact: { kind: "SALES", paused: true, followupsOff: false, tags: [] } })).plan).toBeNull();
    expect(planFollowup(input({ contact: { kind: "PERSONAL", paused: false, followupsOff: false, tags: [] } })).plan).toBeNull();
    expect(planFollowup(input({ contact: { kind: "SALES", paused: false, followupsOff: false, tags: ["not_now"] } })).plan).toBeNull();
  });
});

// ---------------------------------------------------------------- after the call
describe("after the call", () => {
  const past = booking({ start: h(-3), end: h(-2.5), createdAt: h(-48) });

  it("asks whether they showed, and does nothing on its own", () => {
    const r = planFollowup(input({ booking: past, rec: rec({ their_last_at: h(-40), our_last_at: h(-39) }) }));
    expect(r.plan).toBeNull();
    expect(r.why).toMatch(/show/);
    expect(planFollowup(input({ booking: { ...past, attendance: "SHOWED" } })).plan).toBeNull();
  });

  it("no-show: a warm check-in first, then the re-book offer; stops when they write", () => {
    const quiet = rec({ their_last_at: h(-40), our_last_at: h(-39) });
    const first = planFollowup(input({ booking: { ...past, attendance: "NO_SHOW" }, rec: quiet })).plan!;
    expect(first.sequence).toBe("no_show");
    expect(first.step.id).toBe("check-in");
    expect(first.dueAt).toBe(h(-2)); // 30 min after the call ended: due now
    const second = planFollowup(input({ booking: { ...past, attendance: "NO_SHOW" }, rec: quiet, history: [done(first.key, "no_show", first.episode, "check-in", h(0))] })).plan!;
    expect(second.step.id).toBe("rebook");
    const replied = planFollowup(input({ booking: { ...past, attendance: "NO_SHOW" }, rec: rec({ their_last_at: h(-1), our_last_at: h(-0.5) }) }));
    expect(replied.plan).toBeNull();
  });
});

// ---------------------------------------------------------------- sequences config
describe("sequence settings", () => {
  it("fills in defaults and cleans what the editor sends", () => {
    const set = resolveSequenceSet([{ key: "pre_call", enabled: false, steps: [{ label: "x".repeat(200), timing: { kind: "day_before", time: "25:00" } }] }, { key: "nope", enabled: true, steps: [] }]);
    expect(set.pre_call.enabled).toBe(false);
    expect(set.pre_call.steps[0].label.length).toBe(60);
    expect(set.pre_call.steps[0].timing).toEqual({ kind: "day_before", time: "17:00" });
    expect(set.no_reply_lead.enabled).toBe(true);
    // A no-reply step can only wait.
    expect(cleanSequence("no_reply_lead", { steps: [{ timing: { kind: "day_of", time: "09:00" } }] }).steps[0].timing.kind).toBe("after");
  });
});

// ---------------------------------------------------------------- the engine
function memorySetter(contact: SetterContact, thread: ThreadMessage[], state?: SetterRecord) {
  const states = new Map<string, SetterRecord>(state ? [[contact.id, state]] : []);
  const drafts = new Map<string, DraftView>();
  let seq = 0;
  const store: SetterStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    loadState: async (id) => states.get(id) ?? null,
    saveState: async (c, r) => void states.set(c.id, r),
    pendingDraft: async (id) => [...drafts.values()].find((d) => d.contactId === id && d.status === "PENDING") ?? null,
    createDraft: async (i: NewDraft) => {
      for (const d of drafts.values()) if (d.status === "PENDING") d.status = "DISCARDED";
      const d: DraftView = { ...i, id: `d${++seq}`, status: "PENDING", createdAt: NOW.toISOString() };
      drafts.set(d.id, d);
      return d;
    },
    getDraft: async (id) => drafts.get(id) ?? null,
    claimDraft: async () => true,
    markSent: async (id) => void (drafts.get(id)!.status = "SENT"),
    releaseDraft: async () => {},
    discardDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "DISCARDED";
      return true;
    },
    listPending: async () => [...drafts.values()].filter((d) => d.status === "PENDING"),
    send: async () => {},
    setSetterStage: async () => {},
  };
  return { store, states, drafts };
}

const contact: SetterContact = { id: "c1", workspaceId: "w1", igUserId: "101", username: "sam", conversationId: "conv", kind: "SALES", paused: false, tags: [], setterStage: "qualify" };
const quietThread: ThreadMessage[] = [
  { id: "m1", text: "honestly the DMs are the bit that kills me", incoming: true, at: h(-3) },
  { id: "m2", text: "makes sense. what's the bit that eats most of your week?", incoming: false, at: h(-2) },
];
const noop = async () => {};

describe("engine", () => {
  it("queues one step, idempotently, and never two at once", async () => {
    const steps = memorySequenceStore();
    const { store } = memorySetter(contact, quietThread, rec());
    const a = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: NOW });
    const b = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: NOW });
    expect(a.live?.stepId).toBe("value");
    expect(b.live?.id).toBe(a.live?.id);
    expect([...steps.steps.values()].filter((s) => s.status === "QUEUED")).toHaveLength(1);
    // Even a direct second queue for another key leaves one live step.
    await steps.queue({ ...a.live!, key: "other", stepId: "proof" }, "test");
    expect([...steps.steps.values()].filter((s) => s.status === "QUEUED" || s.status === "DRAFTED")).toHaveLength(1);
  });

  it("cancels the queued step when they reply", async () => {
    const steps = memorySequenceStore();
    const { store, states } = memorySetter(contact, quietThread, rec());
    const a = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: NOW });
    states.set("c1", rec({ their_last_at: h(0), our_last_at: h(-2) }));
    const b = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: NOW });
    expect(b.live).toBeNull();
    expect(steps.steps.get(a.live!.id)?.status).toBe("CANCELLED");
  });

  it("skip moves to the next step; cancel stops the sequence", async () => {
    const steps = memorySequenceStore();
    const { store } = memorySetter(contact, quietThread, rec());
    const a = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: NOW });
    await skipStep("w1", a.live!.id, { steps, setter: store, schedule: noop, now: NOW });
    const live = [...steps.steps.values()].find((s) => s.status === "QUEUED");
    expect(live?.stepId).toBe("proof");
    await cancelSequence("w1", "c1", { steps, setter: store, schedule: noop, now: NOW });
    expect([...steps.steps.values()].find((s) => s.status === "QUEUED")).toBeUndefined();
    expect((await syncFollowups("c1", { steps, setter: store, schedule: noop, now: NOW })).live).toBeNull();
  });

  it("a reschedule moves the reminder, a cancel stops it", async () => {
    const bookings = new Map([["b1", { ...booking({ createdAt: h(-30) }), contactId: "c1" }]]);
    const steps = memorySequenceStore({ bookings });
    const { store } = memorySetter(contact, quietThread, rec());
    const at = new Date("2026-10-22T16:30:00Z");
    const a = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: at });
    expect(a.live?.stepId).toBe("day-before");
    bookings.get("b1")!.start = "2026-10-27T15:00:00Z";
    const b = await syncFollowups("c1", { steps, setter: store, schedule: noop, now: at });
    expect(b.live?.id).not.toBe(a.live?.id);
    expect(steps.steps.get(a.live!.id)?.status).toBe("CANCELLED");
    bookings.get("b1")!.status = "CANCELLED";
    bookings.get("b1")!.cancelledAt = at.toISOString();
    expect((await syncFollowups("c1", { steps, setter: store, schedule: noop, now: at })).live).toBeNull();
  });

  it("showed: a voice-note task for Kevin, once, and nothing automated", async () => {
    const bookings = new Map([["b1", { ...booking({ start: h(-3), end: h(-2.5), createdAt: h(-48) }), contactId: "c1" }]]);
    const steps = memorySequenceStore({ bookings });
    const { store } = memorySetter(contact, quietThread, rec({ their_last_at: h(-40), our_last_at: h(-39) }));
    await markAttendance("w1", "c1", "SHOWED", "user", { steps, setter: store, schedule: noop, now: NOW });
    await markAttendance("w1", "c1", "SHOWED", "user", { steps, setter: store, schedule: noop, now: NOW });
    expect(steps.tasks.size).toBe(1);
    const task = [...steps.tasks.values()][0];
    expect(task.title).toBe("Send a personal voice note to @sam");
    expect(task.context.lastWords).toContain("honestly the DMs are the bit that kills me");
    expect([...steps.steps.values()].filter((s) => s.status === "QUEUED")).toHaveLength(0);
    // A no-show instead starts the human re-engagement.
    await markAttendance("w1", "c1", "NO_SHOW", "user", { steps, setter: store, schedule: noop, now: NOW });
    expect([...steps.steps.values()].find((s) => s.status === "QUEUED")?.sequence).toBe("no_show");
  });
});

// ---------------------------------------------------------------- deliverStep
describe("deliverStep", () => {
  const knowledge = fileKnowledgeSource();
  const fixedSet = (): SequenceSet => {
    const set = defaultSequenceSet();
    set.no_reply_qualifying.steps[0] = { ...set.no_reply_qualifying.steps[0], fixedLine: "random thought, how's the DM side going?" };
    return set;
  };

  async function queued(set: SequenceSet, state: SetterRecord, thread = quietThread) {
    const steps = memorySequenceStore({ sets: { default: set } });
    const s = memorySetter(contact, thread, state);
    const r = await syncFollowups("c1", { steps, setter: s.store, schedule: noop, now: NOW });
    return { steps, ...s, step: r.live! };
  }

  it("a fixed line becomes a draft without the model, flagged outside 24h", async () => {
    const state = rec({ their_last_at: h(-30), our_last_at: h(-25) });
    const thread: ThreadMessage[] = [
      { id: "m1", text: "the DMs kill me", incoming: true, at: h(-30) },
      { id: "m2", text: "what eats most of your week?", incoming: false, at: h(-25) },
    ];
    const { steps, store, step } = await queued(fixedSet(), state, thread);
    const r = await deliverStep(step.id, { force: true, steps, setter: store, knowledge, schedule: noop, now: NOW });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.fixed).toBe(true);
    expect(r.draft.kind).toBe("followup");
    expect(r.draft.bubbles).toEqual(["random thought, how's the DM side going?"]);
    expect(r.draft.humanAgent).toBe(true);
    expect(r.draft.flags).toContain("human_agent");
    expect(steps.steps.get(step.id)?.status).toBe("DRAFTED");
    // Delivering again is a no-op that returns the same draft.
    const again = await deliverStep(step.id, { force: true, steps, setter: store, knowledge, schedule: noop, now: NOW });
    expect(again.status === "drafted" && again.draft.id).toBe(r.draft.id);
  });

  it("is cancelled at send time when they replied in the meantime", async () => {
    const { steps, store, step } = await queued(fixedSet(), rec());
    const replied = [...quietThread, { id: "m3", text: "ha yeah still on it", incoming: true, at: h(-1) }];
    store.readThread = async () => replied;
    const r = await deliverStep(step.id, { force: true, steps, setter: store, knowledge, schedule: noop, now: NOW });
    expect(r.status).toBe("cancelled");
    expect(steps.steps.get(step.id)?.status).toBe("CANCELLED");
  });

  it("never replaces a reply draft waiting for Kevin: it waits", async () => {
    const { steps, store, step, drafts } = await queued(fixedSet(), rec());
    drafts.set("dr", { id: "dr", contactId: "c1", kind: "reply", anchor: "m1", bubbles: ["x"], status: "PENDING", reasoning: null, setterStage: null, humanAgent: false, flags: [], backend: "fake", createdAt: NOW.toISOString() });
    const r = await deliverStep(step.id, { force: true, steps, setter: store, knowledge, schedule: noop, now: NOW });
    expect(r.status).toBe("deferred");
    expect(drafts.get("dr")?.status).toBe("PENDING");
    expect(new Date(steps.steps.get(step.id)!.dueAt).getTime()).toBe(NOW.getTime() + 30 * 60_000);
  });

  it("J holding is valid: the step is skipped and the next one queued", async () => {
    const holdThread: ThreadMessage[] = [quietThread[0], { ...quietThread[1], text: "[fake:hold] what eats most of your week?" }];
    const { steps, store, step } = await queued(defaultSequenceSet(), rec(), holdThread);
    const r = await deliverStep(step.id, { force: true, steps, setter: store, knowledge, schedule: noop, now: NOW });
    expect(r.status).toBe("skipped");
    expect([...steps.steps.values()].find((s) => s.status === "QUEUED")?.stepId).toBe("proof");
  });

  it("J writes the step with its intent; a voice phrase rides in the text", async () => {
    const set = defaultSequenceSet();
    set.no_reply_qualifying.steps[0] = { ...set.no_reply_qualifying.steps[0], voicePhrase: "hey, still with me?" };
    const { steps, store, step } = await queued(set, rec());
    const r = await deliverStep(step.id, { force: true, steps, setter: store, knowledge, schedule: noop, now: NOW });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.fixed).toBe(false);
    expect(r.draft.bubbles[0]).toBe("hey, still with me?");
    expect(r.draft.bubbles.length).toBeGreaterThan(1);
  });

  it("nurture picks an active resource with a link they haven't had", () => {
    const offered = [
      { slug: "a", type: "resource", status: "active", resource_url: "https://x/a" },
      { slug: "b", type: "resource", status: "active", resource_url: "https://x/b" },
      { slug: "s", type: "setter", status: "active" },
    ];
    expect(nurturePick(offered, rec({ resources_sent: ["a"] }), [])?.slug).toBe("b");
    expect(nurturePick(offered, rec({ resources_sent: ["a"] }), ["sent:b"])).toBeNull();
  });
});

// ---------------------------------------------------------------- webhooks
describe("calendar webhooks", () => {
  const secret = "s3cret";
  it("checks Cal.com and Calendly signatures", () => {
    const body = '{"triggerEvent":"BOOKING_CANCELLED"}';
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyCalcomSignature(body, sig, secret)).toBe(true);
    expect(verifyCalcomSignature(body, sig, "other")).toBe(false);
    expect(verifyCalcomSignature(`${body} `, sig, secret)).toBe(false);
    const t = Math.floor(NOW.getTime() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    expect(verifyCalendlySignature(body, `t=${t},v1=${v1}`, secret, NOW.getTime())).toBe(true);
    expect(verifyCalendlySignature(body, `t=${t},v1=${v1}`, secret, NOW.getTime() + 10 * 60_000)).toBe(false); // replay
    expect(verifyCalendlySignature(body, `t=${t},v1=deadbeef`, secret, NOW.getTime())).toBe(false);
  });

  it("reads Cal.com events", () => {
    expect(parseCalcomEvent({ triggerEvent: "BOOKING_RESCHEDULED", payload: { uid: "new", rescheduleUid: "old", startTime: "2026-10-27T15:00:00.000Z", attendees: [{ email: "Sam@X.io" }] } })).toMatchObject({
      kind: "rescheduled",
      externalId: "new",
      previousExternalId: "old",
      start: "2026-10-27T15:00:00Z",
      email: "sam@x.io",
    });
    expect(parseCalcomEvent({ triggerEvent: "BOOKING_CANCELLED", payload: { uid: "u1" } }).kind).toBe("cancelled");
    expect(parseCalcomEvent({ triggerEvent: "BOOKING_NO_SHOW_UPDATED", payload: { bookingUid: "u1", attendees: [{ email: "a@b.c", noShow: true }] } })).toMatchObject({ kind: "no_show", externalId: "u1" });
    expect(parseCalcomEvent({ triggerEvent: "BOOKING_NO_SHOW_UPDATED", payload: { bookingUid: "u1", attendees: [{ email: "a@b.c", noShow: false }] } }).kind).toBe("no_show_cleared");
    expect(parseCalcomEvent({ triggerEvent: "PING", payload: {} }).kind).toBe("ignored");
  });

  it("reads Calendly events; a reschedule's cancel half is ignored", () => {
    const sched = { start_time: "2026-10-27T15:00:00.000000Z", end_time: "2026-10-27T15:30:00.000000Z" };
    expect(parseCalendlyEvent({ event: "invitee.created", payload: { uri: "inv2", old_invitee: "inv1", email: "a@b.c", scheduled_event: sched } })).toMatchObject({
      kind: "rescheduled",
      externalId: "inv2",
      previousExternalId: "inv1",
      start: "2026-10-27T15:00:00Z",
    });
    expect(parseCalendlyEvent({ event: "invitee.canceled", payload: { uri: "inv1", rescheduled: true } }).kind).toBe("ignored");
    expect(parseCalendlyEvent({ event: "invitee.canceled", payload: { uri: "inv1", rescheduled: false } }).kind).toBe("cancelled");
    expect(parseCalendlyEvent({ event: "invitee_no_show.created", payload: { invitee: "inv1" } })).toMatchObject({ kind: "no_show", externalId: "inv1" });
  });
});
