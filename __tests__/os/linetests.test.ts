import { describe, expect, it } from "vitest";
import { linesBlock, linesForDraft, recordSent, stableUnit, tagsFor, testFor } from "../../lib/os/experiments";
import { lineTestView, openerSummary, stageLineRows } from "../../lib/os/experiments/data";
import { countFunnel, emptyCounts, factsFromRecord, stageRank, type Exposure, type FunnelCounts } from "../../lib/os/experiments/funnel";
import { lineForStage, planVariationMigration } from "../../lib/os/experiments/migrate-variations";
import { lineVerdict } from "../../lib/os/experiments/stats";
import type { AssignmentRow, ExperimentFull, ExperimentStore, Person } from "../../lib/os/experiments/store";
import { baseSlot, parseSlot, scopedSlot, stageLineOf } from "../../lib/os/experiments/types";
import { cleanLineVariants, runningClash } from "../../lib/os/experiments/validate";
import { traceLines, toolLinesBlock } from "../../lib/os/setter/agent/brief";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { approveDraft, discardDraft, draftForContact } from "../../lib/os/setter/service";
import type { SetterRecord, ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";

function exp(over: Partial<ExperimentFull> = {}): ExperimentFull {
  return {
    id: "e1",
    workspaceId: "w1",
    setterId: null,
    name: "test",
    slot: "line:permission_ask",
    status: "RUNNING",
    allocation: "EVEN",
    minSends: 30,
    winnerVariantId: null,
    startedAt: new Date("2026-10-01T00:00:00Z"),
    finishedAt: null,
    variants: [
      { id: "a", label: "A", text: "cool if I ask a couple of q's to see if I can actually help?", weight: 1, active: true, style: null },
      { id: "b", label: "B", text: "mind if I ask you 2 quick things first?", weight: 1, active: true, style: null },
    ],
    ...over,
  };
}

function memStore(list: ExperimentFull[]) {
  const rows: AssignmentRow[] = [];
  let seq = 0;
  const find = (experimentId: string, p: Person) => rows.find((a) => a.experimentId === experimentId && a.instagramAccountId === p.instagramAccountId && a.igUserId === p.igUserId) ?? null;
  const store: ExperimentStore = {
    running: async (ws, slots) => list.filter((e) => e.workspaceId === ws && e.status === "RUNNING" && slots.includes(e.slot)),
    findAssignment: async (id, p) => find(id, p),
    createAssignment: async (experimentId, variantId, p) => {
      const existing = find(experimentId, p);
      if (existing) return existing;
      const r: AssignmentRow = { id: `a${++seq}`, experimentId, variantId, instagramAccountId: p.instagramAccountId, igUserId: p.igUserId, contactId: p.contactId ?? null, assignedAt: new Date(), sentAt: null, draftId: null, edited: false };
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
    pickWinner: async (_ws, id, variantId) => {
      const e = list.find((x) => x.id === id)!;
      for (const v of e.variants) v.active = v.id === variantId;
      e.winnerVariantId = variantId;
      return true;
    },
    assignments: async (id) => rows.filter((r) => r.experimentId === id),
  };
  return { store, rows };
}

const person = (igUserId: string): Person => ({ workspaceId: "w1", instagramAccountId: "acc1", igUserId });
const input = (store: ExperimentStore, over: Partial<Parameters<typeof linesForDraft>[0]> = {}) => ({
  workspaceId: "w1",
  setterId: "j",
  person: person("u1"),
  name: "Sam",
  entry: null,
  actionKind: "reply",
  firstMessage: false,
  nudgesSoFar: 0,
  alreadyInvited: false,
  store,
  ...over,
});

describe("slots and scope", () => {
  it("parses the workflow scope", () => {
    expect(parseSlot("line:qualifying:workflow:wf1")).toEqual({ kind: "line", ref: "qualifying", workflowId: "wf1" });
    expect(parseSlot("line:qualifying")).toEqual({ kind: "line", ref: "qualifying" });
    expect(parseSlot("line:invite:workflow:")).toBeNull();
    expect(scopedSlot("line:invite", "wf1")).toBe("line:invite:workflow:wf1");
    expect(scopedSlot("line:invite:workflow:wf1", null)).toBe("line:invite");
    expect(baseSlot("j_opener:any:workflow:x")).toBe("j_opener:any");
  });

  it("maps the six stage lines onto slots", () => {
    expect(stageLineOf("j_opener:post_keyword")?.key).toBe("first_reply");
    expect(stageLineOf("line:invite")?.key).toBe("call_offer");
    expect(stageLineOf("line:value_offer:workflow:w")?.key).toBe("release");
    expect(stageLineOf("line:follow_up_1")?.key).toBe("nudge");
    expect(stageLineOf("line:qualifying")?.key).toBe("qualifying");
    expect(stageLineOf("campaign_opener:a1")).toBeNull();
  });

  it("the workflow's test beats the setter-wide one, and this setter's beats every setter's", () => {
    const all = exp({ id: "all", setterId: null });
    const mine = exp({ id: "mine", setterId: "j" });
    const wf = exp({ id: "wf", setterId: "j", slot: "line:permission_ask:workflow:w1" });
    const other = exp({ id: "other", setterId: "nova" });
    expect(testFor([all, mine, wf, other], "line:permission_ask", "j", "w1")?.id).toBe("wf");
    expect(testFor([all, mine, wf, other], "line:permission_ask", "j", "w2")?.id).toBe("mine");
    expect(testFor([all, mine, wf, other], "line:permission_ask", "j")?.id).toBe("mine");
    expect(testFor([all, other], "line:permission_ask", "j")?.id).toBe("all");
    expect(testFor([other], "line:permission_ask", "j")).toBeNull();
  });

  it("linesForDraft uses the workflow test inside that workflow only", async () => {
    const { store } = memStore([exp({ id: "mine", setterId: "j" }), exp({ id: "wf", setterId: "j", slot: "line:permission_ask:workflow:w1" })]);
    expect((await linesForDraft(input(store, { workflowId: "w1" }))).map((l) => [l.experimentId, l.key])).toEqual([["wf", "permission_ask"]]);
    expect((await linesForDraft(input(store))).map((l) => l.experimentId)).toEqual(["mine"]);
  });

  it("one running test per line per scope", () => {
    const list = [exp({ id: "r", setterId: "j" }), exp({ id: "d", setterId: "j", status: "DRAFT", slot: "line:invite" })];
    expect(runningClash(list, { slot: "line:permission_ask", setterId: "j" })?.id).toBe("r");
    expect(runningClash(list, { slot: "line:permission_ask", setterId: null })?.id).toBe("r");
    expect(runningClash(list, { slot: "line:permission_ask", setterId: "nova" })).toBeNull();
    expect(runningClash(list, { slot: "line:permission_ask:workflow:w1", setterId: "j" })).toBeNull();
    expect(runningClash(list, { id: "r", slot: "line:permission_ask", setterId: "j" })).toBeNull();
    expect(runningClash(list, { slot: "line:invite", setterId: "j" })).toBeNull(); // a draft isn't running
  });

  it("a draft may hold one version, a running test needs two", () => {
    expect(cleanLineVariants(["only one"], false)).toMatchObject({ variants: [{ label: "A", text: "only one" }] });
    expect(cleanLineVariants(["only one"], true)).toEqual({ error: "Write a B to start the test." });
    expect(cleanLineVariants(["a", "A"], true)).toEqual({ error: "Two versions say the same thing." });
    expect(cleanLineVariants(["a", "b", "c", "d"], true)).toHaveProperty("error");
  });
});

describe("assignment", () => {
  it("is stable before the line goes out, and only J's variant is offered", async () => {
    const { store, rows } = memStore([exp()]);
    const first = await linesForDraft(input(store));
    for (let i = 0; i < 5; i++) expect((await linesForDraft(input(store))).map((l) => l.variantId)).toEqual(first.map((l) => l.variantId));
    expect(first).toHaveLength(1);
    expect(rows).toHaveLength(0); // nothing assigned until it goes out
    // Different people spread over both versions.
    const picks = new Set(Array.from({ length: 40 }, (_, i) => (stableUnit("e1", person(`p${i}`)) < 0.5 ? "a" : "b")));
    expect(picks).toEqual(new Set(["a", "b"]));
  });

  it("is fixed for good once sent, even after Pick winner", async () => {
    const e = exp();
    const { store, rows } = memStore([e]);
    const [line] = await linesForDraft(input(store, { random: () => 0.9 })); // B
    expect(line.variantId).toBe("b");
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: tagsFor([line], ["permission_ask"], ["x"]), bubbles: ["x"], edited: false, at: new Date(), store });
    expect(rows).toEqual([expect.objectContaining({ variantId: "b", draftId: "d1" })]);
    await store.pickWinner("w1", "e1", "a");
    // They had B: it is never offered again, and their row stays B.
    expect(await linesForDraft(input(store))).toEqual([]);
    expect(rows[0].variantId).toBe("b");
    // Someone new gets the winner.
    expect((await linesForDraft(input(store, { person: person("u2") })))[0].variantId).toBe("a");
  });

  it("the prompt and get_step carry only the assigned variant", async () => {
    const { store } = memStore([exp()]);
    const lines = await linesForDraft(input(store, { random: () => 0 }));
    const block = linesBlock(lines);
    expect(block).toContain("cool if I ask a couple of q's");
    expect(block).not.toContain("mind if I ask you 2 quick things");
    const trace = traceLines(lines);
    expect(trace).toEqual([{ slot: "line:permission_ask", variantId: "a", label: "permission_ask", text: lines[0].text, when: expect.stringContaining("permission") }]);
    expect(JSON.stringify(trace)).not.toContain("2 quick things");
    expect(toolLinesBlock(lines)).toContain("reply.lines_used");
  });
});

describe("exposure", () => {
  const tags = [{ experimentId: "e1", variantId: "a", slot: "line:permission_ask", used: true }];

  it("sent: counted once, on the first send", async () => {
    const { store, rows } = memStore([exp()]);
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: tags, bubbles: ["cool if I ask a couple of q's to see if I can actually help?"], edited: false, at: new Date("2026-10-19T10:00:00Z"), store });
    await recordSent({ person: person("u1"), draftId: "d2", abVariants: tags, bubbles: ["again"], edited: false, at: new Date("2026-10-20T10:00:00Z"), store });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ draftId: "d1", edited: false });
  });

  it("edited heavily: flagged, still counted", async () => {
    const { store, rows } = memStore([exp()]);
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: tags, bubbles: ["quick one, what's your goal?"], edited: true, at: new Date(), store });
    expect(rows[0]).toMatchObject({ edited: true });
    expect(rows[0].sentAt).not.toBeNull();
  });

  it("not used: J didn't report it and the words aren't there", async () => {
    const { store, rows } = memStore([exp()]);
    await recordSent({ person: person("u1"), draftId: "d1", abVariants: [{ ...tags[0], used: false }], bubbles: ["haha nice"], edited: false, at: new Date(), store });
    expect(rows).toHaveLength(0);
    // The overlap check backs up J forgetting to report it.
    const t = tagsFor([{ experimentId: "e1", variantId: "a", slot: "line:permission_ask", key: "permission_ask", text: exp().variants[0].text, forced: false }], [], ["cool if I ask a couple of q's to see if I can actually help?"]);
    expect(t[0].used).toBe(true);
  });

  describe("through J's draft and Approve / reject", () => {
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
        createDraft: async (i: NewDraft) => {
          const d: DraftView = { ...i, id: `d${++seq}`, status: "PENDING", createdAt: now.toISOString() };
          drafts.set(d.id, d);
          return d;
        },
        getDraft: async (id) => drafts.get(id) ?? null,
        claimDraft: async (id) => (drafts.get(id)!.status = "APPROVED") === "APPROVED",
        markSent: async (id, s) => void Object.assign(drafts.get(id)!, { status: "SENT", bubbles: s.bubbles }),
        releaseDraft: async () => {},
        discardDraft: async (id) => {
          drafts.get(id)!.status = "DISCARDED";
          return true;
        },
        listPending: async () => [],
        send: async () => {},
        setSetterStage: async () => {},
      };
      return store;
    }
    const opener = () => exp({ id: "jo", slot: "j_opener:any", variants: [{ id: "a", label: "A", text: "yo what are you building?", weight: 1, active: true, style: null }] });

    it("rejected: never counted", async () => {
      const { store: experiments, rows } = memStore([opener()]);
      const store = setterStore();
      const r = await draftForContact("c1", { store, knowledge: fileKnowledgeSource(), now, experiments });
      if (r.status !== "drafted") throw new Error(r.status);
      expect(r.draft.abVariants).toHaveLength(1);
      await discardDraft(r.draft.id, "w1", store);
      expect(rows).toHaveLength(0);
    });

    it("approved: counted when it goes out", async () => {
      const { store: experiments, rows } = memStore([opener()]);
      const store = setterStore();
      const r = await draftForContact("c1", { store, knowledge: fileKnowledgeSource(), now, experiments });
      if (r.status !== "drafted") throw new Error(r.status);
      expect(rows).toHaveLength(0);
      await approveDraft(r.draft.id, "w1", { store, now: () => now, gapMs: 0, experiments });
      expect(rows).toEqual([expect.objectContaining({ variantId: "a", draftId: r.draft.id })]);
    });
  });
});

describe("results", () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 10, h)).toISOString();
  const f = (over: Partial<ReturnType<typeof factsFromRecord>>) => ({ ...factsFromRecord(null), ...over });

  it("next stage: J's stage moved past the one the line went out at", () => {
    expect(stageRank("permission")).toBe(2);
    expect(stageRank("Invite")).toBe(4);
    const ex: Exposure[] = [
      { variantId: "a", sentAt: at(1), edited: false, facts: f({ setterStage: "qualify" }), stageAtSend: "permission" },
      { variantId: "a", sentAt: at(1), edited: false, facts: f({ setterStage: "permission" }), stageAtSend: "permission" },
      // No draft stage: the line's own stage is used.
      { variantId: "a", sentAt: at(1), edited: false, facts: f({ setterStage: "bridge" }), lineStage: "qualify" },
      // Booked counts as moving on.
      { variantId: "a", sentAt: at(1), edited: false, facts: f({ bookedAts: [at(3)] }), stageAtSend: "bridge" },
      // Not sent: nothing counts.
      { variantId: "a", sentAt: null, edited: false, facts: f({ setterStage: "booked" }), stageAtSend: "opener" },
    ];
    const c = countFunnel(ex);
    expect(c).toMatchObject({ sent: 4, nextStage: 3, booked: 1 });
  });

  it("too early until 30 reached each version, then replies decide", () => {
    const arm = (id: string, reached: number, replied: number, booked = 0) => ({ id, label: id.toUpperCase(), reached, replied, booked });
    expect(lineVerdict([arm("a", 29, 20), arm("b", 40, 5)])).toEqual({ kind: "too_early", needed: 1 });
    expect(lineVerdict([arm("a", 30, 20), arm("b", 30, 10)])).toMatchObject({ kind: "leader", metric: "replied", leaderId: "a" });
    expect(lineVerdict([arm("a", 30, 10), arm("b", 30, 10)])).toEqual({ kind: "tie", metric: "replied" });
    // Bookings decide only once each version has 10.
    expect(lineVerdict([arm("a", 100, 60, 10), arm("b", 100, 40, 20)])).toMatchObject({ kind: "leader", metric: "booked", leaderId: "b" });
    expect(lineVerdict([arm("a", 100, 60, 9), arm("b", 100, 40, 20)])).toMatchObject({ metric: "replied", leaderId: "a" });
    expect(lineVerdict([arm("a", 300, 200), arm("b", 300, 60)])).toMatchObject({ clear: true });
    expect(lineVerdict([arm("a", 30, 16), arm("b", 30, 15)])).toMatchObject({ clear: false });
    expect(lineVerdict([arm("a", 50, 10)])).toEqual({ kind: "empty" });
  });

  it("the view: scope chip, a picked loser stays visible but isn't judged without data", () => {
    const counts = new Map<string, FunnelCounts>([
      ["a", { ...emptyCounts(), sent: 34, replied: 21 }],
      ["b", { ...emptyCounts(), sent: 31, replied: 15 }],
    ]);
    const v = lineTestView(exp({ setterId: "j" }), counts, "j");
    expect(v).toMatchObject({ scope: "setter", workflowId: null, verdict: { kind: "leader", leaderId: "a" } });
    expect(lineTestView(exp({ setterId: null }), counts, "j").scope).toBe("all");
    expect(lineTestView(exp({ slot: "line:permission_ask:workflow:w9" }), counts, "j")).toMatchObject({ scope: "workflow", workflowId: "w9" });
    expect(lineTestView(exp({ slot: "j_opener:post_keyword" }), counts, "j").entry).toBe("Post keyword");
    expect(lineTestView(exp(), new Map([["a", { ...emptyCounts(), sent: 5 }]]), "j").verdict).toEqual({ kind: "too_early", needed: 30 });
  });

  it("rows: six lines, stopped tests hidden, running first", () => {
    const run = exp({ id: "r" });
    const draft = exp({ id: "d", status: "DRAFT" });
    const stopped = exp({ id: "s", status: "FINISHED", slot: "line:invite" });
    const rows = stageLineRows([draft, run, stopped].map((e) => ({ e, view: lineTestView(e, new Map(), "j") })));
    expect(rows.map((r) => r.label)).toEqual(["First reply", "Permission ask", "Qualifying questions", "Call offer", "Release message", "Nudge"]);
    expect(rows[1].tests.map((t) => t.id)).toEqual(["r", "d"]);
    expect(rows[3].tests).toEqual([]);
  });

  it("campaign opener note on the row", () => {
    const e = exp({ slot: "campaign_opener:a1" });
    expect(openerSummary(e, new Map())).toBe("A/B · too early");
    const counts = new Map<string, FunnelCounts>([
      ["a", { ...emptyCounts(), sent: 40, replied: 10 }],
      ["b", { ...emptyCounts(), sent: 40, replied: 20 }],
    ]);
    expect(openerSummary(e, counts)).toBe("A/B replied · A 25% · B 50%");
  });
});

describe("migrating the old Funnel variations", () => {
  const setter = (funnel: unknown) => ({ id: "j", workspaceId: "w1", name: "J", funnel });

  it("maps stages onto lines", () => {
    expect(lineForStage("open", "Open")).toBe("first_reply");
    expect(lineForStage("permission", "Permission")).toBe("permission_ask");
    expect(lineForStage("qualify", "Qualify")).toBe("qualifying");
    expect(lineForStage("bridge", "Bridge")).toBe("call_offer");
    expect(lineForStage("book", "Book")).toBe("call_offer");
    expect(lineForStage("value", "Value")).toBe("release");
    expect(lineForStage("x", "Whatever")).toBeNull();
  });

  it("a draft per stage, the funnel loses the text and the ab switch, and a re-run does nothing", () => {
    const funnel = [
      { key: "permission", label: "Permission", guidance: "ask", variations: ["mind if I ask?", "cool if I ask a couple q's?"], ab: true },
      { key: "qualify", label: "Qualify", guidance: "goal" },
      { key: "misc", label: "Misc", guidance: "x", variations: ["keep me"] },
    ];
    const plan = planVariationMigration([setter(funnel)], []);
    expect(plan.create).toEqual([expect.objectContaining({ setterId: "j", line: "permission_ask", slot: "line:permission_ask", texts: ["mind if I ask?", "cool if I ask a couple q's?"] })]);
    expect(plan.skipped).toEqual([{ setterName: "J", stage: "Misc", texts: 1 }]);
    const cleaned = plan.funnels[0].funnel;
    expect(cleaned[0]).toEqual({ key: "permission", label: "Permission", guidance: "ask" });
    expect(cleaned[2]).toMatchObject({ variations: ["keep me"] });

    // Applied, then run again: nothing new.
    const again = planVariationMigration([setter(cleaned)], [{ setterId: "j", slot: "line:permission_ask", texts: ["mind if I ask?", "cool if I ask a couple q's?"] }]);
    expect(again.create).toEqual([]);
    expect(again.funnels).toEqual([]);
    // Crashed between creating the test and cleaning the funnel: no duplicate.
    const crashed = planVariationMigration([setter(funnel)], [{ setterId: "j", slot: "line:permission_ask", texts: ["cool if I ask a couple q's?", "mind if I ask?"] }]);
    expect(crashed.create).toEqual([]);
    expect(crashed.already).toHaveLength(1);
  });

  it("more versions than a test holds: the rest waits for the next run", () => {
    const plan = planVariationMigration([setter([{ key: "open", label: "Open", guidance: "hi", variations: ["a", "b", "c", "d"] }])], []);
    expect(plan.create[0].texts).toEqual(["a", "b", "c"]);
    expect(plan.funnels[0].funnel[0]).toMatchObject({ variations: ["d"] });
  });
});
