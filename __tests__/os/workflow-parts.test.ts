// Workflow pieces around the engine: keyword uniqueness (E12), builder
// warnings (S7), templates, stats, publish moves (K5), Draft/Auto (J14/J15),
// sequences (O1/O2), Friday (O3), the webhook reader, J's hold guard.
import { describe, expect, it } from "vitest";
import { selectAudience, workflowBusy } from "@/lib/os/broadcasts/audience";
import type { BroadcastContact } from "@/lib/os/broadcasts/types";
import { planFollowup } from "@/lib/os/sequences/plan";
import { defaultSequenceSet } from "@/lib/os/sequences/types";
import { checkAction } from "@/lib/os/setter/agent/actions";
import { newTurnState, stepView, type AgentEnv } from "@/lib/os/setter/agent/context";
import { decideAutoSend } from "@/lib/os/setter/autopilot";
import { newRecord } from "@/lib/os/setter/state";
import { moveProblems, waitingOnRemoved } from "@/lib/os/workflows/api-impl";
import { validateGraph, type WorkflowGraph } from "@/lib/os/workflows/graph";
import { readWebhook } from "@/lib/os/workflows/hooks";
import { heuristicClassify, nextSetterTimer, onSignal, quietReleaseAt, releaseRulesView, stepBlock } from "@/lib/os/workflows/setter-step";
import { computeStats } from "@/lib/os/workflows/stats";
import { templateGraph, TEMPLATES } from "@/lib/os/workflows/templates";
import { keywordClashes, matchTrigger, zernioKeywordsOf } from "@/lib/os/workflows/triggers";
import type { VersionDef, WorkflowDef } from "@/lib/os/workflows/types";
import { graphWarnings } from "@/lib/os/workflows/warnings";

const H = 3600_000;
const commentGraph = (keyword: string, postIds: string[] | "any"): WorkflowGraph => {
  const g = templateGraph("send_link", { keyword, resource: "x" });
  (g.nodes[0].data as { postIds: unknown }).postIds = postIds;
  return g;
};
const wf = (id: string): WorkflowDef => ({ id, workspaceId: "w", instagramAccountId: null, name: id, mode: "draft", active: true, currentVersionId: `${id}v` });
const ver = (id: string, graph: WorkflowGraph): VersionDef => ({ id: `${id}v`, workflowId: id, number: 1, graph, keywords: [] });

describe("E12 one keyword, one place", () => {
  it("blocks two workflows with the same keyword on the same post, or both on any post", () => {
    expect(keywordClashes(commentGraph("GUIDE", "any"), [{ id: "b", name: "B", graph: commentGraph("guide", "any") }], [], [])).toHaveLength(1);
    expect(keywordClashes(commentGraph("GUIDE", ["p1"]), [{ id: "b", name: "B", graph: commentGraph("GUIDE", ["p1", "p2"]) }], [], [])).toHaveLength(1);
    expect(keywordClashes(commentGraph("GUIDE", ["p1"]), [{ id: "b", name: "B", graph: commentGraph("GUIDE", ["p2"]) }], [], [])).toHaveLength(0);
  });
  it("any post + a specific post may live together: the specific post wins when matching", () => {
    const anyG = commentGraph("GUIDE", "any");
    const postG = commentGraph("GUIDE", ["p1"]);
    expect(keywordClashes(postG, [{ id: "a", name: "A", graph: anyG }], [], [])).toHaveLength(0);
    const live = [
      { wf: wf("a"), version: ver("a", anyG) },
      { wf: wf("b"), version: ver("b", postG) },
    ];
    expect(matchTrigger(live, { surface: "comment", text: "guide please", postIds: ["p1"] })?.wf.id).toBe("b");
    expect(matchTrigger(live, { surface: "comment", text: "guide please", postIds: ["p9"] })?.wf.id).toBe("a");
    expect(matchTrigger(live, { surface: "dm", text: "guide" })).toBeNull();
  });
  it("never in a live OpenReply campaign or a Zernio keyword", () => {
    const g = commentGraph("SETTER", "any");
    expect(keywordClashes(g, [], [{ id: "c1", name: "Old", keywords: ["setter"], postId: "p1", matchAnyPost: false, dmTriggerEnabled: false }], [])[0]).toMatchObject({ with: "campaign" });
    const zernio = zernioKeywordsOf([
      { slug: "setter-starter", name: "Setter Starter", keyword: "SETTER", status: "ACTIVE", data: {} },
      { slug: "lm", name: "LM", keyword: "LEADTEST", status: "ACTIVE", data: { engine: "openreply" } },
      { slug: "old", name: "Old", keyword: "OLD", status: "DRAFT", data: {} },
    ]);
    expect(zernio.map((z) => z.slug)).toEqual(["setter-starter"]);
    expect(keywordClashes(g, [], [], zernio)[0]).toMatchObject({ with: "zernio", keyword: "setter" });
  });
});

describe("builder", () => {
  it("S7 warns about waits past Instagram's 24h and 7 days", () => {
    const g: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "dm", keywords: ["X"] } },
        { id: "w", type: "wait", position: { x: 1, y: 0 }, data: { mode: "delay", minutes: 2 * 24 * 60 } },
        { id: "w2", type: "wait", position: { x: 2, y: 0 }, data: { mode: "until_reply", timeoutMinutes: 8 * 24 * 60 } },
      ],
      edges: [
        { id: "a", from: "t", fromPort: "next", to: "w" },
        { id: "b", from: "w", fromPort: "next", to: "w2" },
      ],
    };
    const msgs = graphWarnings(g).map((w) => w.message);
    expect(msgs).toContain("Past Instagram's 24h: will need your approval (HUMAN_AGENT) or won't send after 7 days");
    expect(msgs).toContain("Past 7 days: Instagram won't let anything send after this");
  });
  it("templates are valid graphs, laid out left to right", () => {
    for (const t of TEMPLATES) {
      const g = templateGraph(t.id, { keyword: "GUIDE", resource: "setter-starter" });
      expect(validateGraph(g), t.id).toEqual([]);
      const main = g.nodes.filter((n) => n.position.y === 0).map((n) => n.position.x);
      expect([...main].sort((a, b) => a - b), t.id).toEqual(main);
    }
    const hold = templateGraph("hold_lead_magnet", { resource: "setter-starter" });
    expect(hold.nodes.find((n) => n.type === "setter")!.data).toMatchObject({ goal: "book_call", leadMagnet: { mode: "hold", resources: ["setter-starter"] } });
  });
});

describe("stats", () => {
  const g = templateGraph("hold_lead_magnet", { resource: "s" });
  const at = new Date("2026-10-20T00:00:00Z");
  const ev = (runId: string, nodeId: string, kind: string, port: string | null = null, data?: unknown) => ({ runId, nodeId, kind, port, at, versionId: "v1", data });
  it("reached per step, share of the step before as 0–1, setter releases per rule, exits on arrows", () => {
    const events = [
      ...["r1", "r2", "r3", "r4"].map((r) => ev(r, "trigger", "enter")),
      ...["r1", "r2", "r3", "r4"].map((r) => ev(r, "opener", "enter")),
      ...["r1", "r2", "r3"].map((r) => ev(r, "setter", "enter")),
      ev("r1", "setter", "replied"),
      ev("r1", "setter", "released", null, { rule: "R1" }),
      ev("r2", "setter", "released", null, { rule: "R2" }),
      ev("r1", "setter", "booked"),
      ev("r2", "setter", "leave", "exit:quiet"),
    ];
    const s = computeStats(g, events, { period: "30d", now: new Date("2026-10-21T00:00:00Z"), showedRuns: new Set(["r1"]) });
    expect(s.nodes.setter.reached).toBe(3);
    expect(s.nodes.setter.pctOfPrev).toBe(0.75);
    expect(s.nodes.trigger.pctOfPrev).toBeNull();
    expect(s.nodes.setter.setter).toMatchObject({ replied: 1, released: 2, booked: 1, showed: 1, releasedBy: { booked: 1, quiet: 1, notReady: 0, askedTwice: 0, notFit: 0 } });
    expect(s.ports["setter:exit:quiet"]).toBe(1);
    expect(s.header).toEqual({ triggered: 4, replied: 1, leadMagnet: 2, booked: 1, showed: 1 });
  });
  it("a Randomizer shows the funnel per branch", () => {
    const rg: WorkflowGraph = {
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "dm", keywords: ["AB"] } },
        { id: "r", type: "randomizer", position: { x: 1, y: 0 }, data: { branches: [{ id: "a", label: "A", weight: 1 }, { id: "b", label: "B", weight: 1 }] } },
      ],
      edges: [{ id: "e", from: "t", fromPort: "next", to: "r" }],
    };
    const s = computeStats(
      rg,
      [ev("r1", "r", "leave", "branch:a"), ev("r2", "r", "leave", "branch:a"), ev("r3", "r", "leave", "branch:b"), ev("r1", "m", "replied"), ev("r1", "j", "booked"), ev("r3", "j", "released")],
      { period: "all", now: at, showedRuns: new Set(["r1"]) }
    );
    expect(s.nodes.r.branches).toEqual({ a: { reached: 2, replied: 1, leadMagnet: 0, booked: 1, showed: 1 }, b: { reached: 1, replied: 0, leadMagnet: 1, booked: 0, showed: 0 } });
  });
});

describe("K5 publish with people on a removed step", () => {
  it("needs a target for each removed step that has people waiting", () => {
    const g = templateGraph("send_link", { resource: "x" });
    const waiting = waitingOnRemoved([{ currentNodeId: "gone" }, { currentNodeId: "gone" }, { currentNodeId: "link" }], g);
    expect(waiting).toEqual([{ nodeId: "gone", count: 2 }]);
    expect(moveProblems(waiting, {}, g)[0].message).toMatch(/2 people are waiting/);
    expect(moveProblems(waiting, { gone: "trigger" }, g)).toHaveLength(1);
    expect(moveProblems(waiting, { gone: "link" }, g)).toEqual([]);
  });
});

describe("J14 / J15 Draft and Auto", () => {
  const funnel = [{ key: "qualify", label: "Qualify", autopilot: "approve" }] as never;
  const draft = { status: "PENDING" as const, kind: "reply", flags: [] as string[], setterStage: "qualify" };
  const contact = { kind: "SALES" as const, paused: false };
  it("J14 Draft: J's words wait for Approve even on an Auto stage", () => {
    const auto = [{ key: "qualify", label: "Qualify", autopilot: "auto" }] as never;
    expect(decideAutoSend({ draft, contact, funnel: auto, workflowMode: "draft" })).toEqual({ send: false, reason: "workflow is in Draft" });
  });
  it("J15 Auto: sends whatever the stage says, but not what needs a person", () => {
    expect(decideAutoSend({ draft, contact, funnel, workflowMode: "auto" })).toEqual({ send: true, stage: "workflow" });
    expect(decideAutoSend({ draft: { ...draft, flags: ["hand_to_kevin"] }, contact, funnel, workflowMode: "auto" }).send).toBe(false);
    expect(decideAutoSend({ draft: { ...draft, kind: "booking" }, contact, funnel, workflowMode: "auto" }).send).toBe(true);
    expect(decideAutoSend({ draft, contact: { ...contact, paused: true }, funnel, workflowMode: "auto" }).send).toBe(false);
    expect(decideAutoSend({ draft: { ...draft, kind: "booking" }, contact, funnel, workflowMode: null }).send).toBe(false);
  });
});

describe("O1 / O2 follow-up sequences", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  const rec = { ...newRecord("c", "sam", "c1"), state: "in_conversation" as const, their_last_at: "2026-10-21T08:00:00Z", our_last_at: "2026-10-21T09:00:00Z" };
  const base = { now, rec, sequences: defaultSequenceSet(), history: [], contact: { kind: "SALES" as const, paused: false, followupsOff: false, tags: [], setterStage: "qualify" } };
  it("O1 inside a workflow the Setter step's timeout replaces the gone-quiet sequences", () => {
    expect(planFollowup({ ...base, booking: null }).plan).not.toBeNull();
    expect(planFollowup({ ...base, booking: null, contact: { ...base.contact, inWorkflow: true } })).toEqual({ plan: null, why: "In a workflow: its Setter step follows up." });
  });
  it("O2 before-call sequences still run", () => {
    const booking = { id: "b1", start: "2026-10-23T15:00:00Z", end: null, timezone: "Europe/London", status: "BOOKED" as const, attendance: null, createdAt: "2026-10-21T10:00:00Z" };
    expect(planFollowup({ ...base, booking, contact: { ...base.contact, inWorkflow: true } }).plan?.sequence).toBe("pre_call");
  });
});

describe("O3 Follow-up Friday", () => {
  const c = (over: Partial<BroadcastContact>): BroadcastContact => ({
    contactId: "c",
    username: "sam",
    fullName: null,
    kind: "SALES",
    paused: false,
    tags: ["follow-up-friday"],
    igUserId: "u",
    conversationId: null,
    theirLastAt: "2026-10-23T08:00:00Z",
    ourLastAt: null,
    setterStage: null,
    stage: null,
    notes: null,
    fields: [],
    ...over,
  });
  it("skips anyone in a live run who had a message in the last 48h, and paused contacts", () => {
    const from = new Date("2026-10-23T10:00:00Z");
    expect(workflowBusy(c({ inWorkflow: true }), from)).toBe(true);
    expect(workflowBusy(c({ inWorkflow: true, theirLastAt: "2026-10-20T08:00:00Z" }), from)).toBe(false);
    const r = selectAudience([c({ contactId: "a", inWorkflow: true }), c({ contactId: "b", paused: true }), c({ contactId: "d" })], { tag: "follow-up-friday", from, until: new Date("2026-10-23T15:00:00Z") });
    expect(r.excluded.map((e) => [e.contact.contactId, e.reason])).toEqual([
      ["a", "In a workflow"],
      ["b", "Paused"],
    ]);
    expect(r.eligible.map((e) => e.contact.contactId)).toEqual(["d"]);
  });
});

describe("Setter step rules", () => {
  const d = { goal: "book_call" as const, leadMagnet: { mode: "hold" as const, resources: ["s"] }, release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true }, quietHours: [18, 22] as [number, number], saveTo: [] };
  const s0 = { held: ["s"], released: [], asks: 0, lowEffort: 0, replies: 0, notes: [] };
  it("R5 not a fit releases with a warm close and drops the call push", () => {
    const o = onSignal(s0, d, { kind: "reply", c: heuristicClassify("I'm just a student tbh") });
    expect(o.release).toBe("R5");
    expect(o.state.goal).toBe("start_conversation");
  });
  it("a rule switched off doesn't release", () => {
    const off = { ...d, release: { ...d.release, askedTwice: false } };
    expect(onSignal({ ...s0, asks: 1 }, off, { kind: "reply", c: heuristicClassify("where's the link?") }).release).toBeNull();
  });
  it("R2 lands inside the window, never later than 23h", () => {
    const last = new Date("2026-10-21T00:00:00Z");
    expect(quietReleaseAt(last, [18, 22], () => 0)!.getTime() - last.getTime()).toBe(18 * H);
    expect(quietReleaseAt(last, [30, 40], () => 0)!.getTime() - last.getTime()).toBe(23 * H);
  });
  it("Quiet once the free window closes with no reply", () => {
    const last = new Date("2026-10-21T00:00:00Z");
    const plan = nextSetterTimer({ ...s0, released: ["s"] }, d, { theirLastAt: last, weWroteLast: true, now: new Date(last.getTime() + H), pendingDraft: false }, () => 0.5);
    expect(plan).toEqual({ kind: "quiet_exit", at: new Date(last.getTime() + 24 * H) });
  });
  it("J sees the step: goal, hold, rules and the release to write now", () => {
    expect(releaseRulesView(d).map((r) => r.id)).toEqual(["R1", "R2", "R3", "R4", "R5"]);
    const block = stepBlock({
      workflowId: "w",
      workflowName: "Setter comments",
      runId: "r",
      nodeId: "n",
      mode: "draft",
      goal: "book_call",
      leadMagnet: { mode: "hold", resources: [{ slug: "s", title: "Setter Starter", released: false }] },
      releaseRules: releaseRulesView(d),
      exits: [],
      directive: { kind: "release", rule: "R4", slugs: ["s"], at: "" },
      notes: ["commented the keyword again"],
      directiveLinks: [],
      held: ["s"],
      sendable: [],
    });
    expect(block).toMatch(/HOLDING Setter Starter/);
    expect(block).toMatch(/RELEASE NOW \(R4\)/);
    expect(block).toMatch(/commented the keyword again/);
  });
  it("J's send_resource refuses a held resource until a rule fires", () => {
    const setter = { offered: { resources: [] }, profile: { episodes: [], business: { sections: {} }, settings: {}, fields: [] }, catalog: { resources: [] } } as unknown as AgentEnv["setter"];
    const env = {
      setter,
      calendar: null,
      step: { held: ["s"], sendable: [{ slug: "s", title: "S", kind: "resource", summary: "", url: "https://x" }] },
    } as unknown as AgentEnv;
    const r = checkAction(env, newTurnState(), "send_resource", { slug: "s" }, new Set());
    expect(r.ok).toBe(false);
    const released = { ...env, step: { ...env.step, directive: { kind: "release" as const, rule: "R4" as const, slugs: ["s"], at: "" } } } as AgentEnv;
    expect(checkAction(released, newTurnState(), "send_resource", { slug: "s" }, new Set()).ok).toBe(true);
    expect(stepView({ ...released, lines: [] }).directive).toEqual({ kind: "release", rule: "R4", slugs: ["s"] });
  });
});

describe("webhook reader", () => {
  it("finds comments, story replies and IG app echoes", () => {
    const r = readWebhook({
      object: "instagram",
      entry: [
        {
          id: "me",
          changes: [{ field: "comments", value: { id: "c1", text: "GUIDE", from: { id: "u1", username: "sam" }, media: { id: "p1" } } }],
          messaging: [
            { sender: { id: "u2" }, recipient: { id: "me" }, message: { mid: "m1", text: "GUIDE", reply_to: { story: { id: "s" } } } },
            { sender: { id: "me" }, recipient: { id: "u3" }, message: { mid: "m2", text: "hey it's kevin", is_echo: true } },
            { sender: { id: "u4" }, recipient: { id: "me" }, message: { mid: "m3", text: "plain dm" } },
          ],
        },
      ],
    });
    expect(r.comments).toMatchObject([{ commentId: "c1", fromId: "u1", postId: "p1" }]);
    expect(r.stories).toMatchObject([{ fromId: "u2", mid: "m1" }]);
    expect(r.echoes).toEqual([{ instagramId: "me", toId: "u3", text: "hey it's kevin" }]);
  });
});
