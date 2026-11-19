// Several triggers on one workflow: "PLAN" on any post AND "PLAN" by DM, both
// running the same steps. Real engine, fake Zernio (workflow-harness): nothing
// is sent anywhere.
import { describe, expect, it } from "vitest";
import { triggerList, validateGraph, withTriggerList, type StepData, type WorkflowGraph } from "@/lib/os/workflows/graph";
import { templateGraph } from "@/lib/os/workflows/templates";
import { addTrigger, graphKeywords, graphTriggers, keywordClashes, matchTrigger } from "@/lib/os/workflows/triggers";
import { harness, text } from "./workflow-harness";

const H = 3600_000;

/** PLAN-like: comment PLAN on any post + DM PLAN, a button, then the link. */
const plan = (): WorkflowGraph =>
  templateGraph("send_link", {
    resource: "quiz",
    triggers: [
      { kind: "comment", keywords: ["PLAN"], postIds: "any" },
      { kind: "dm", keywords: ["PLAN"] },
    ],
  });

/** An older single-trigger workflow, as it sits in the database today (no extraTriggers). */
const legacy = (keyword: string, kind: StepData<"trigger">["kind"] = "comment", postIds: string[] | "any" = "any"): WorkflowGraph => {
  const g = templateGraph("send_link", { keyword, kind, resource: "script-vault" });
  const t = g.nodes[0].data as StepData<"trigger">;
  t.postIds = postIds;
  return g;
};

const trig = (g: WorkflowGraph) => g.nodes.find((n) => n.type === "trigger")!.data as StepData<"trigger">;
const other = (id: string, graph: WorkflowGraph) => ({ id, name: `WF ${id}`, graph });

describe("the trigger list", () => {
  it("a multi-trigger graph is publishable; an empty extra trigger is not", () => {
    expect(validateGraph(plan())).toEqual([]);
    expect(graphTriggers(plan()).map((t) => `${t.kind}:${t.keywords}`)).toEqual(["comment:PLAN", "dm:PLAN"]);
    expect(graphKeywords(plan())).toEqual(["plan"]);
    const g = addTrigger(legacy("VAULT"), { kind: "dm", keywords: [] });
    expect(validateGraph(g).map((p) => p.message)).toContain("Add a keyword to trigger 2");
  });

  it("old single-trigger workflows read as a one-item list and round-trip unchanged", () => {
    const g = legacy("VAULT");
    const d = trig(g);
    expect(d.extraTriggers).toBeUndefined();
    expect(triggerList(d)).toEqual([{ kind: "comment", keywords: ["VAULT"], postIds: "any" }]);
    expect(withTriggerList(d, triggerList(d))).toEqual(d);
    expect(graphKeywords(g)).toEqual(["vault"]);
    expect(validateGraph(g)).toEqual([]);
    // Old callers (keyword + kind) still get a single trigger.
    expect(trig(templateGraph("blank", { keyword: "X", kind: "dm" })).extraTriggers).toBeUndefined();
  });

  it("addTrigger adds the DM twin once, keeping the first trigger in place", () => {
    const g = addTrigger(legacy("PLAN"), { kind: "dm", keywords: ["PLAN"] });
    expect(trig(g).kind).toBe("comment");
    expect(trig(g).keywords).toEqual(["PLAN"]);
    expect(triggerList(trig(g)).map((t) => t.kind)).toEqual(["comment", "dm"]);
    expect(addTrigger(g, { kind: "dm", keywords: ["plan"] })).toBe(g);
    expect(validateGraph(g)).toEqual([]);
  });

  it("removing the first trigger promotes the next one", () => {
    const d = trig(plan());
    const next = withTriggerList(d, triggerList(d).slice(1));
    expect(next.kind).toBe("dm");
    expect(next.extraTriggers).toBeUndefined();
    expect(next.publicReplies).toEqual(d.publicReplies);
  });
});

describe("matching", () => {
  const live = () => [
    { wf: { id: "plan" } as never, version: { graph: plan() } as never },
    { wf: { id: "vault" } as never, version: { graph: legacy("VAULT") } as never },
  ];

  it("a DM and a comment both find the multi-trigger workflow; whole words, any case", () => {
    expect(matchTrigger(live(), { surface: "dm", text: "plan" })?.wf.id).toBe("plan");
    expect(matchTrigger(live(), { surface: "dm", text: "Can I get the PLAN?" })?.wf.id).toBe("plan");
    expect(matchTrigger(live(), { surface: "comment", text: "PLAN", postIds: ["p1"] })?.wf.id).toBe("plan");
    expect(matchTrigger(live(), { surface: "dm", text: "planning ahead" })).toBeNull();
    expect(matchTrigger(live(), { surface: "story_reply", text: "plan" })).toBeNull();
  });

  it("an old comment-only workflow still ignores DMs", () => {
    expect(matchTrigger(live(), { surface: "dm", text: "vault" })).toBeNull();
    expect(matchTrigger(live(), { surface: "comment", text: "vault", postIds: ["p1"] })?.wf.id).toBe("vault");
  });
});

describe("clashes across all triggers", () => {
  it("same keyword + same channel + overlapping posts clashes, from any trigger", () => {
    // Another workflow already has DM PLAN: the second trigger of ours clashes.
    expect(keywordClashes(plan(), [other("b", legacy("PLAN", "dm"))], [], [])).toEqual([{ keyword: "plan", with: "workflow", id: "b", name: "WF b" }]);
    // And the reverse: an old DM workflow publishing against the live multi-trigger one.
    expect(keywordClashes(legacy("plan", "dm"), [other("a", plan())], [], [])).toHaveLength(1);
    // Two multi-trigger workflows: one clash per workflow and keyword (not one per trigger).
    expect(keywordClashes(plan(), [other("c", plan())], [], [])).toHaveLength(1);
  });

  it("different channel or non-overlapping posts don't clash", () => {
    // Story reply PLAN is another channel.
    expect(keywordClashes(plan(), [other("s", legacy("PLAN", "story_reply"))], [], [])).toEqual([]);
    // Comment PLAN on one specific post vs ours on "any post": the specific one wins at match time, no clash.
    expect(keywordClashes(plan(), [other("p", legacy("PLAN", "comment", ["p7"]))], [], [])).toEqual([]);
    // Two comment triggers on the same post clash.
    const mine = addTrigger(legacy("VAULT", "dm"), { kind: "comment", keywords: ["PLAN"], postIds: ["p7"] });
    expect(keywordClashes(mine, [other("p", legacy("PLAN", "comment", ["p7", "p8"]))], [], [])).toHaveLength(1);
  });

  it("a DM trigger clashes with a campaign only when the campaign answers DMs; Zernio sees every keyword", () => {
    const camp = { id: "c1", name: "Old", keywords: ["plan"], postId: "p9", matchAnyPost: false, dmTriggerEnabled: true };
    const dmOnly = legacy("PLAN", "dm");
    expect(keywordClashes(dmOnly, [], [camp], [])).toHaveLength(1);
    expect(keywordClashes(dmOnly, [], [{ ...camp, dmTriggerEnabled: false }], [])).toEqual([]);
    // The multi-trigger one hits on the comment trigger (any post overlaps p9) once.
    expect(keywordClashes(plan(), [], [camp], [])).toHaveLength(1);
    expect(keywordClashes(addTrigger(legacy("VAULT"), { kind: "dm", keywords: ["GUIDE"] }), [], [], [{ slug: "z", name: "Z", keywords: ["guide"] }])).toHaveLength(1);
  });
});

describe("the engine, one workflow with a comment AND a DM trigger", () => {
  it("DM 'plan' starts it: no public reply, no private reply, the opener goes as a DM", async () => {
    const h = harness();
    h.publish(plan());
    const out = await h.dm("amy", "plan");
    expect(out.outcome?.status).toBe("started");
    const s = h.sentTo("amy");
    expect(s.map((x) => x.via)).toEqual(["dm"]);
    expect(text(s[0].msg)).toMatch(/here's what you asked for/);
    const run = (await h.run("amy"))!;
    expect(run.trigger.kind).toBe("dm");
    expect(run.keyword).toBe("plan");
    expect(run.state.gate).toBe(false);
    // Same steps after: tap the button, get the link.
    await h.tap("amy", `wf:${run.id}:opener:send`);
    expect(h.sentTo("amy").map((x) => text(x.msg))).toContain("https://kevin.link/quiz");
  });

  it("a comment PLAN still runs the comment way: public reply + private reply", async () => {
    const h = harness();
    h.publish(plan());
    const out = await h.comment("bob", "PLAN");
    expect(out.status).toBe("started");
    expect(h.sentTo("bob").map((x) => x.via)).toEqual(["public", "private"]);
    expect((await h.run("bob"))!.trigger.kind).toBe("comment");
  });

  it("a DM PLAN while that run is live is a repeat: no public reply, no second opener", async () => {
    const h = harness();
    h.publish(plan());
    await h.dm("cat", "plan");
    const runId = (await h.run("cat"))!.id;
    await h.dm("cat", "PLAN please");
    expect((await h.run("cat"))!.id).toBe(runId);
    expect(h.sentTo("cat").filter((x) => x.via === "public")).toHaveLength(0);
    expect(h.sentTo("cat").filter((x) => /here's what you asked for/.test(text(x.msg)))).toHaveLength(1);
  });

  it("Instagram's 24h window still holds for a DM-started run: a step past it becomes a to-do, nothing is sent", async () => {
    const h = harness();
    const n = (id: string, type: WorkflowGraph["nodes"][number]["type"], data: unknown) => ({ id, type, position: { x: 0, y: 0 }, data });
    const e = (from: string, fromPort: string, to: string) => ({ id: `${from}-${fromPort}`, from, fromPort, to });
    const late: WorkflowGraph = {
      version: 1,
      nodes: [
        n("trigger", "trigger", { kind: "comment", keywords: ["PLAN"], publicReplies: ["check your DMs"] }),
        n("w", "wait", { mode: "delay", minutes: 25 * 60 }),
        n("m", "message", { bubbles: [{ kind: "text", text: "late" }] }),
      ],
      edges: [e("trigger", "next", "w"), e("w", "next", "m")],
    };
    h.publish(addTrigger(late, { kind: "dm", keywords: ["PLAN"] }));
    await h.dm("dan", "plan");
    await h.wait(26 * H);
    expect(h.sentTo("dan")).toHaveLength(0);
    expect(h.todos.map((t) => t.title)).toEqual(["Workflow step is past Instagram's 24h: send it yourself?"]);
  });

  it("an old comment-only workflow is unchanged: a DM of its keyword starts nothing", async () => {
    const h = harness();
    h.publish(legacy("VAULT"));
    const out = await h.dm("eve", "vault");
    expect(out.outcome).toBeUndefined();
    expect(h.sentTo("eve")).toHaveLength(0);
    expect((await h.comment("eve", "VAULT")).status).toBe("started");
    expect(h.sentTo("eve").map((x) => x.via)).toEqual(["public", "private"]);
  });
});
