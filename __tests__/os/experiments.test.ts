import { describe, expect, it } from "vitest";
import { campaignOpenerText, candidateSlots, linesBlock, linesForDraft, recordSent, tagsFor } from "../../lib/os/experiments";
import { eligible, fillName, keepOrPick, pickVariant } from "../../lib/os/experiments/assign";
import { toView } from "../../lib/os/experiments/data";
import { byVariant, countFunnel, factsFromRecord, type Exposure } from "../../lib/os/experiments/funnel";
import { editedHeavily, lineKept, lineUsed } from "../../lib/os/experiments/similarity";
import { pct, verdict, wilson } from "../../lib/os/experiments/stats";
import type { AssignmentRow, ExperimentFull, ExperimentStore, Person } from "../../lib/os/experiments/store";
import { parseSlot, type VariantLite } from "../../lib/os/experiments/types";
import { cleanInput } from "../../lib/os/experiments/validate";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { approveDraft, draftForContact } from "../../lib/os/setter/service";
import type { SetterRecord, ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";

const V = (id: string, weight = 1, active = true, text = `line ${id}`): VariantLite => ({ id, label: id.toUpperCase(), text, weight, active });

function exp(over: Partial<ExperimentFull> = {}): ExperimentFull {
  return {
    id: "e1",
    workspaceId: "w1",
    setterId: null,
    name: "test",
    slot: "campaign_opener:a1",
    status: "RUNNING",
    allocation: "EVEN",
    minSends: 50,
    winnerVariantId: null,
    startedAt: new Date("2026-10-01T00:00:00Z"),
    finishedAt: null,
    variants: [
      { ...V("a"), style: null },
      { ...V("b"), style: null },
    ],
    ...over,
  };
}

function memExperiments(list: ExperimentFull[]) {
  const rows: AssignmentRow[] = [];
  let seq = 0;
  const find = (experimentId: string, p: Person) =>
    rows.find((a) => a.experimentId === experimentId && a.instagramAccountId === p.instagramAccountId && a.igUserId === p.igUserId) ?? null;
  const store: ExperimentStore = {
    running: async (ws, slots) => list.filter((e) => e.workspaceId === ws && e.status === "RUNNING" && slots.includes(e.slot)),
    findAssignment: async (id, p) => find(id, p),
    createAssignment: async (experimentId, variantId, p) => {
      const existing = find(experimentId, p);
      if (existing) return existing;
      const r: AssignmentRow = {
        id: `a${++seq}`,
        experimentId,
        variantId,
        instagramAccountId: p.instagramAccountId,
        igUserId: p.igUserId,
        contactId: p.contactId ?? null,
        assignedAt: new Date(),
        sentAt: null,
        draftId: null,
        edited: false,
      };
      rows.push(r);
      return r;
    },
    markSent: async (id, p, s) => {
      const a = find(id, p);
      if (a && !a.sentAt) Object.assign(a, { sentAt: s.at, draftId: s.draftId, edited: s.edited });
    },
    list: async () => list,
    get: async (_ws, id) => list.find((e) => e.id === id) ?? null,
    create: async () => {
      throw new Error("not in tests");
    },
    setStatus: async () => true,
    updateDraft: async () => true,
    removeDraft: async () => true,
    pickWinner: async () => true,
    assignments: async (id) => rows.filter((r) => r.experimentId === id),
  };
  return { store, rows };
}

const person = (igUserId: string): Person => ({ workspaceId: "w1", instagramAccountId: "acc1", igUserId });

describe("assignment", () => {
  it("weights picks and skips inactive or empty variants", () => {
    const vs = [V("a", 1), V("b", 3), V("c", 5, false), { ...V("d", 2), text: "  " }];
    expect(eligible(vs, "WEIGHTED").map((x) => [x.v.id, x.w])).toEqual([
      ["a", 1],
      ["b", 3],
    ]);
    expect(pickVariant(vs, "WEIGHTED", 0)?.id).toBe("a");
    expect(pickVariant(vs, "WEIGHTED", 0.24)?.id).toBe("a");
    expect(pickVariant(vs, "WEIGHTED", 0.26)?.id).toBe("b");
    expect(pickVariant(vs, "WEIGHTED", 0.9999)?.id).toBe("b");
    // Even ignores the weights.
    expect(pickVariant(vs, "EVEN", 0.49)?.id).toBe("a");
    expect(pickVariant(vs, "EVEN", 0.51)?.id).toBe("b");
    expect(pickVariant([V("x", 1, false)], "EVEN", 0.5)).toBeNull();
  });

  it("splits close to the weights over many people", () => {
    const vs = [V("a", 1), V("b", 3)];
    let b = 0;
    for (let i = 0; i < 4000; i++) if (pickVariant(vs, "WEIGHTED", (i + 0.5) / 4000)?.id === "b") b++;
    expect(b / 4000).toBeCloseTo(0.75, 2);
  });

  it("keeps a contact's variant, even after it is switched off", () => {
    const vs = [V("a", 1, false), V("b")];
    expect(keepOrPick("a", vs, "EVEN", 0.99)).toEqual({ variant: vs[0], isNew: false });
    expect(keepOrPick("gone", vs, "EVEN", 0.1)).toEqual({ variant: vs[1], isNew: true });
    expect(keepOrPick(null, vs, "EVEN", 0.1).isNew).toBe(true);
  });

  it("fills names", () => {
    expect(fillName("hey {first_name}, saw you commented", "Sam Ortega")).toBe("hey Sam, saw you commented");
    expect(fillName("hey {first_name}!", null)).toBe("hey there!");
  });

  it("the campaign hook is sticky per person and falls back to the original", async () => {
    const { store, rows } = memExperiments([exp()]);
    const input = { workspaceId: "w1", automationId: "a1", instagramAccountId: "acc1", igUserId: "u1", original: "orig", store };
    const first = await campaignOpenerText({ ...input, random: () => 0.9 });
    expect(first).toBe("line b");
    // A retry (or a second comment) never re-rolls.
    expect(await campaignOpenerText({ ...input, random: () => 0.1 })).toBe("line b");
    expect(rows).toHaveLength(1);
    expect(await campaignOpenerText({ ...input, igUserId: "u2", random: () => 0.1 })).toBe("line a");
    // No experiment on that campaign, or the store is down: the campaign's own text.
    expect(await campaignOpenerText({ ...input, automationId: "other" })).toBe("orig");
    const broken = { ...store, running: async () => Promise.reject(new Error("db down")) };
    expect(await campaignOpenerText({ ...input, store: broken })).toBe("orig");
  });

  it("doesn't use a paused experiment", async () => {
    const { store } = memExperiments([exp({ status: "PAUSED" })]);
    expect(await campaignOpenerText({ workspaceId: "w1", automationId: "a1", instagramAccountId: "acc1", igUserId: "u1", original: "orig", store })).toBe("orig");
  });
});

describe("J's lines", () => {
  it("offers opener slots on the first message, key lines later", () => {
    const base = { entry: "post_keyword", nudgesSoFar: 0, alreadyInvited: false };
    expect(candidateSlots({ ...base, actionKind: "value_opener", firstMessage: true })).toEqual(["j_opener:post_keyword", "j_opener:any"]);
    expect(candidateSlots({ ...base, actionKind: "reply", firstMessage: false })).toEqual(["line:permission_ask", "line:qualifying", "line:value_offer", "line:invite"]);
    expect(candidateSlots({ ...base, actionKind: "reply", firstMessage: false, alreadyInvited: true })).not.toContain("line:invite");
    expect(candidateSlots({ ...base, actionKind: "nudge", firstMessage: false })).toContain("line:follow_up_1");
    expect(candidateSlots({ ...base, actionKind: "nudge", firstMessage: false, nudgesSoFar: 1 })).not.toContain("line:follow_up_1");
  });

  it("the specific entry beats any, and a line already sent isn't offered again", async () => {
    const { store } = memExperiments([
      exp({ id: "any", slot: "j_opener:any" }),
      exp({ id: "pk", slot: "j_opener:post_keyword", variants: [{ ...V("x", 1, true, "hey {first_name}, what are you building?"), style: null }] }),
    ]);
    const input = {
      workspaceId: "w1",
      setterId: null,
      person: person("u1"),
      name: "Sam",
      entry: "post_keyword",
      actionKind: "value_opener",
      firstMessage: true,
      nudgesSoFar: 0,
      alreadyInvited: false,
      store,
      random: () => 0,
    };
    const lines = await linesForDraft(input);
    expect(lines.map((l) => [l.experimentId, l.key, l.text, l.forced])).toEqual([["pk", "opener", "hey Sam, what are you building?", true]]);
    expect(linesBlock(lines)).toContain('Say it like this: "hey Sam, what are you building?"');
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: tagsFor(lines, ["opener"], ["hey"]), bubbles: ["hey"], edited: false, at: new Date(), store });
    expect((await linesForDraft(input)).map((l) => l.experimentId)).toEqual(["any"]);
  });

  it("scopes to the setter", async () => {
    const { store } = memExperiments([exp({ slot: "line:invite", setterId: "s2" })]);
    const input = { workspaceId: "w1", person: person("u1"), name: null, entry: null, actionKind: "reply", firstMessage: false, nudgesSoFar: 0, alreadyInvited: false, store };
    expect(await linesForDraft({ ...input, setterId: "s1" })).toEqual([]);
    expect(await linesForDraft({ ...input, setterId: "s2" })).toHaveLength(1);
  });

  it("tags what the draft used: reported, forced, or matched in the text", () => {
    const lines = [
      { experimentId: "e1", variantId: "a", slot: "line:invite", key: "invite", text: "want me to share my screen for 15 min this week?", forced: false },
      { experimentId: "e2", variantId: "b", slot: "line:permission_ask", key: "permission_ask", text: "mind if i ask you something?", forced: false },
      { experimentId: "e3", variantId: "c", slot: "j_opener:any", key: "opener", text: "yo", forced: true },
    ];
    const tags = tagsFor(lines, ["permission_ask"], ["easy, want me to share my screen for 15 min this week?"]);
    expect(tags.map((t) => t.used)).toEqual([true, true, true]);
    expect(tagsFor(lines, [], ["what are you building?"]).map((t) => t.used)).toEqual([false, false, true]);
  });

  it("measures how much of the line Kevin kept", () => {
    expect(lineKept("mind if i ask you something?", "Mind if I ask you something real quick?")).toBe(1);
    expect(lineUsed("mind if i ask you something?", ["totally different words here"])).toBe(false);
    expect(editedHeavily("mind if i ask you something?", ["quick q, can i ask?"])).toBe(true);
    expect(editedHeavily("mind if i ask you something?", ["hey, mind if i ask you something?"])).toBe(false);
  });

  it("recordSent attributes used lines once and flags heavy edits", async () => {
    const e = exp({ id: "e1", slot: "line:invite", variants: [{ ...V("a", 1, true, "want me to share my screen for 15 min this week?"), style: null }] });
    const { store, rows } = memExperiments([e]);
    await store.createAssignment("e1", "a", person("u1"));
    const tags = [{ experimentId: "e1", variantId: "a", slot: "line:invite", used: true }];
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: tags, bubbles: ["wanna hop on a call?"], edited: true, at: new Date("2026-10-19T10:00:00Z"), store });
    expect(rows[0]).toMatchObject({ draftId: "d1", edited: true });
    expect(rows[0].sentAt?.toISOString()).toBe("2026-10-19T10:00:00.000Z");
    // A later draft never moves the first send.
    await recordSent({ person: person("u1"), draftId: "d2", abVariants: tags, bubbles: ["x"], edited: false, at: new Date("2026-10-20T10:00:00Z"), store });
    expect(rows[0].draftId).toBe("d1");
    // Unused lines are not attributed, unless the sent text has the line.
    const { store: s2, rows: r2 } = memExperiments([e]);
    await s2.createAssignment("e1", "a", person("u1"));
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: [{ ...tags[0], used: false }], bubbles: ["x"], edited: false, at: new Date(), store: s2 });
    expect(r2[0].sentAt).toBeNull();
    await recordSent({ person: person("u1"), draftId: "d3", abVariants: [{ ...tags[0], used: false }], bubbles: ["yes!", "want me to share my screen for 15 min this week?"], edited: true, at: new Date(), store: s2 });
    expect(r2[0]).toMatchObject({ draftId: "d3", edited: false });
  });
});

describe("J end to end (fake drafter)", () => {
  const contact: SetterContact = { id: "c1", workspaceId: "w1", igUserId: "101", username: "sam", conversationId: "conv1", kind: "SALES", paused: false, tags: [], instagramAccountId: "acc1" };
  const thread: ThreadMessage[] = [{ id: "m1", text: "hey man love the content, how do you build these agents?", incoming: true, at: "2026-10-18T10:00:00Z" }];
  const now = new Date("2026-10-18T10:05:00Z");

  function setterStore() {
    const states = new Map<string, SetterRecord>();
    const drafts = new Map<string, DraftView>();
    let seq = 0;
    const store: SetterStore = {
      getContact: async () => contact,
      readThread: async () => thread,
      loadState: async (id) => states.get(id) ?? null,
      saveState: async (c, rec) => void states.set(c.id, rec),
      pendingDraft: async () => [...drafts.values()].find((d) => d.status === "PENDING") ?? null,
      createDraft: async (input: NewDraft) => {
        const d: DraftView = { ...input, id: `d${++seq}`, status: "PENDING", createdAt: now.toISOString() };
        drafts.set(d.id, d);
        return d;
      },
      getDraft: async (id) => drafts.get(id) ?? null,
      claimDraft: async (id) => (drafts.get(id)!.status = "APPROVED") === "APPROVED",
      markSent: async (id, s) => void Object.assign(drafts.get(id)!, { status: "SENT", bubbles: s.bubbles }),
      releaseDraft: async () => {},
      discardDraft: async () => true,
      listPending: async () => [],
      send: async () => {},
      setSetterStage: async () => {},
    };
    return store;
  }

  it("J's first draft carries the opener variant, and Approve attributes it", async () => {
    const { store: experiments, rows } = memExperiments([exp({ id: "jo", slot: "j_opener:any", variants: [{ ...V("a", 1, true, "yo what are you building?"), style: null }] })]);
    const store = setterStore();
    const r = await draftForContact("c1", { store, knowledge: fileKnowledgeSource(), now, experiments });
    if (r.status !== "drafted") throw new Error(`expected a draft, got ${r.status}`);
    expect(r.draft.abVariants).toEqual([{ experimentId: "jo", variantId: "a", slot: "j_opener:any", used: true }]);
    // Not assigned until the line actually goes out.
    expect(rows).toHaveLength(0);
    const res = await approveDraft(r.draft.id, "w1", { store, now: () => now, gapMs: 0, experiments });
    expect(res.error).toBeUndefined();
    expect(rows[0].sentAt?.toISOString()).toBe(now.toISOString());
    expect(rows[0].draftId).toBe(r.draft.id);
  });
});

describe("funnel attribution", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
  const facts = (over: Partial<ReturnType<typeof factsFromRecord>> = {}) => ({ ...factsFromRecord(null), ...over });

  it("counts only what happened after the line went out", () => {
    const exposures: Exposure[] = [
      { variantId: "a", sentAt: null, edited: false, facts: facts({ theirLastAt: at(5) }) }, // assigned only
      { variantId: "a", sentAt: at(1), edited: true, facts: facts({ theirLastAt: at(2), valueAts: [at(0), at(3)], inviteAts: [at(4)], bookedAts: [at(6)] }) },
      { variantId: "a", sentAt: at(1), edited: false, facts: facts({ theirLastAt: at(0), valueAts: [at(0)] }) }, // value before the line
      { variantId: "a", sentAt: at(1), edited: false, facts: facts({ stage: "SHOWED" }) },
      { variantId: "a", sentAt: at(1), edited: false, facts: null },
    ];
    expect(countFunnel(exposures)).toEqual({ assigned: 5, sent: 4, edited: 1, replied: 1, nextStage: 0, valueSent: 1, inviteSent: 1, booked: 2, showed: 1 });
  });

  it("a reply at the same instant as the send isn't a reply", () => {
    expect(countFunnel([{ variantId: "a", sentAt: at(1), edited: false, facts: facts({ theirLastAt: at(1) }) }]).replied).toBe(0);
  });

  it("groups by variant and keeps empty variants", () => {
    const m = byVariant([{ variantId: "b", sentAt: at(1), edited: false, facts: null }], ["a", "b"]);
    expect(m.get("a")?.sent).toBe(0);
    expect(m.get("b")?.sent).toBe(1);
  });

  it("reads J's record: deliveries from history, the invite", () => {
    const f = factsFromRecord({
      their_last_at: at(3),
      delivered_at: at(0),
      invited: { at: at(4) },
      history: [
        { at: at(2), event: "delivered:yt02" },
        { at: at(2), event: "drafted:reply" },
      ],
    });
    expect(f.valueAts).toEqual([at(0), at(2)]);
    expect(f.inviteAts).toEqual([at(4)]);
  });
});

describe("interval math", () => {
  it("matches the Wilson score interval", () => {
    const w = wilson(10, 100);
    expect(w.rate).toBe(0.1);
    expect(w.low).toBeCloseTo(0.0552, 3);
    expect(w.high).toBeCloseTo(0.1744, 3);
    const zero = wilson(0, 20);
    expect(zero.low).toBe(0);
    expect(zero.high).toBeCloseTo(0.1611, 3);
    expect(wilson(20, 20).high).toBe(1);
    expect(wilson(0, 0)).toEqual({ low: 0, high: 0, rate: 0 });
  });

  it("says too early until every variant has enough sends", () => {
    const v = verdict(
      [
        { id: "a", label: "A", sent: 64, booked: 4 },
        { id: "b", label: "B", sent: 11, booked: 0 },
      ],
      50
    );
    expect(v.kind).toBe("too_early");
    expect(v.kind === "too_early" && v.needed).toBe(39);
  });

  it("names a leader only when the ranges separate", () => {
    const clear = verdict(
      [
        { id: "a", label: "A", sent: 400, booked: 4 },
        { id: "b", label: "B", sent: 400, booked: 40 },
      ],
      50
    );
    expect(clear).toMatchObject({ kind: "leader", leaderId: "b" });
    const close = verdict(
      [
        { id: "a", label: "A", sent: 60, booked: 3 },
        { id: "b", label: "B", sent: 60, booked: 5 },
      ],
      50
    );
    expect(close).toMatchObject({ kind: "no_clear_winner", leaderId: "b" });
    expect(verdict([{ id: "a", label: "A", sent: 100, booked: 0 }, { id: "b", label: "B", sent: 100, booked: 0 }], 50).kind).toBe("no_clear_winner");
    expect(verdict([{ id: "a", label: "A", sent: 100, booked: 0 }], 50).kind).toBe("empty");
  });

  it("formats rates", () => {
    expect(pct(0.0634)).toBe("6.3%");
    expect(pct(0.29)).toBe("29%");
    expect(pct(0)).toBe("0%");
  });

  it("builds the table view", () => {
    const counts = byVariant(
      [
        { variantId: "a", sentAt: "2026-10-10T01:00:00Z", edited: false, facts: { theirLastAt: "2026-10-10T02:00:00Z", valueAts: [], inviteAts: [], bookedAts: ["2026-10-10T03:00:00Z"], stage: null } },
      ],
      ["a", "b"]
    );
    const view = toView(exp(), counts, { campaigns: new Map([["a1", "Reel"]]), setters: new Map() }, false);
    expect(view.slotLabel).toBe("Opening DM · Reel");
    expect(view.total.sent).toBe(1);
    expect(view.variants[0].booked.rate).toBe(1);
    expect(view.verdict.kind).toBe("too_early");
  });
});

describe("slots and the create form", () => {
  it("parses slots", () => {
    expect(parseSlot("campaign_opener:abc")).toEqual({ kind: "campaign_opener", ref: "abc" });
    expect(parseSlot("line:invite")).toEqual({ kind: "line", ref: "invite" });
    expect(parseSlot("line:nope")).toBeNull();
    expect(parseSlot("j_opener:")).toBeNull();
  });

  it("checks the input", () => {
    const base = { name: "t", slot: "line:invite", setterId: null, allocation: "EVEN" as const, minSends: 50, variants: [{ text: "a" }, { text: "b" }] };
    expect("value" in cleanInput(base, [])).toBe(true);
    expect(cleanInput({ ...base, variants: [{ text: "a" }, { text: " " }] }, [])).toEqual({ error: "Write at least two variants." });
    expect(cleanInput(base, ["line:invite"])).toHaveProperty("error");
    expect(cleanInput({ ...base, variants: [{ text: "Same" }, { text: "same" }] }, [])).toHaveProperty("error");
    expect(cleanInput({ ...base, allocation: "WEIGHTED", variants: [{ text: "a", weight: 0 }, { text: "b" }] }, [])).toHaveProperty("error");
    const ok = cleanInput({ ...base, slot: "campaign_opener:x", setterId: "s1" }, []);
    expect("value" in ok && ok.value.setterId).toBeNull();
    expect("value" in ok && ok.value.variants.map((v) => v.label)).toEqual(["A", "B"]);
  });
});
