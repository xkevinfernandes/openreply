// Workflows inspector forms (stream C2 wfcanvas): bubbles (a link is its own
// bubble), buttons, randomizer weights and A vs B, actions, setter, labels,
// Publish problems, the list/strip numbers, and the mock adapter.

import { describe, expect, it } from "vitest";
import {
  abResults,
  addBranch,
  addBubble,
  addButton,
  addOp,
  fillVars,
  formatMinutes,
  friendlyProblems,
  moveBubble,
  normalizeBubbles,
  parseDuration,
  parseKeywords,
  portLabel,
  problemsByNode,
  removeBranch,
  removeBubble,
  removeButton,
  removeOp,
  savesTo,
  scopeLineRows,
  setButtonLabel,
  setterSummary,
  setWeight,
  toggleRelease,
  updateOp,
  waitWindowWarning,
} from "@/components/os/workflows/forms";
import { defaultData, emptyGraph, addNode, connect } from "@/components/os/workflows/graph-edit";
import { listFunnel, nodeStatText, sinceLabel, stripItems } from "@/components/os/workflows/view";
import { portsOf, type Bubble, type GraphNode, type StepData } from "@/lib/os/workflows/graph";

const sum = (b: { weight: number }[]) => b.reduce((s, x) => s + x.weight, 0);

describe("message bubbles", () => {
  it("splits a pasted URL out of a text bubble into its own link bubble", () => {
    const out = normalizeBubbles([{ kind: "text", text: "here you go https://claudepreneur.com/starter enjoy!" }]);
    expect(out).toEqual([
      { kind: "text", text: "here you go" },
      { kind: "link", url: "https://claudepreneur.com/starter" },
      { kind: "text", text: "enjoy!" },
    ]);
    expect(normalizeBubbles([{ kind: "text", text: "grab it at claudepreneur.com/starter." }])).toEqual([
      { kind: "text", text: "grab it at" },
      { kind: "link", url: "https://claudepreneur.com/starter" },
    ]);
    const plain: Bubble[] = [{ kind: "text", text: "no links here" }];
    expect(normalizeBubbles(plain)).toEqual(plain);
  });

  it("add / move / remove keep at least one bubble and one buttons bubble", () => {
    let b: Bubble[] = [{ kind: "text", text: "a" }];
    b = addBubble(b, "link");
    b = addBubble(b, "buttons");
    expect(addBubble(b, "buttons")).toBe(b);
    expect(b.map((x) => x.kind)).toEqual(["text", "link", "buttons"]);
    expect(moveBubble(b, 0, 1).map((x) => x.kind)).toEqual(["link", "text", "buttons"]);
    expect(moveBubble(b, 0, -1)).toBe(b);
    expect(removeBubble([{ kind: "text", text: "x" }], 0)).toEqual([{ kind: "text", text: "" }]);
  });

  it("IG-style buttons: up to 3, 20 chars, unique ids that become ports", () => {
    let b = addBubble([], "buttons");
    b = addButton(b, 0);
    b = addButton(b, 0);
    expect(addButton(b, 0)).toBe(b);
    const btns = (b[0] as Extract<Bubble, { kind: "buttons" }>).buttons;
    expect(new Set(btns.map((x) => x.id)).size).toBe(3);
    b = setButtonLabel(b, 0, btns[1].id, "a very long label that is too long");
    expect((b[0] as Extract<Bubble, { kind: "buttons" }>).buttons[1].label).toHaveLength(20);
    const node = { type: "message" as const, data: { bubbles: b } };
    expect(portsOf(node)).toEqual(btns.map((x) => `button:${x.id}`));
    let one = removeButton(b, 0, btns[0].id);
    one = removeButton(one, 0, btns[1].id);
    expect(removeButton(one, 0, btns[2].id)).toEqual([{ kind: "text", text: "" }]);
  });

  it("fills {first_name} for the phone preview, leaves unknown vars", () => {
    expect(fillVars("hey {first_name}! {nope}", { first_name: "Tom" })).toBe("hey Tom! {nope}");
  });
});

describe("randomizer", () => {
  const two = (defaultData("randomizer") as StepData<"randomizer">).branches;

  it("weights always add up to 100", () => {
    const b = setWeight(two, "a", 70);
    expect(b.map((x) => x.weight)).toEqual([70, 30]);
    expect(setWeight(two, "a", 0)[0].weight).toBe(1);
    expect(setWeight(two, "a", 150)[0].weight).toBe(99);
    const three = addBranch(two);
    expect(three.map((x) => x.label)).toEqual(["A", "B", "C"]);
    expect(sum(three)).toBe(100);
    const changed = setWeight(three, "b", 50);
    expect(sum(changed)).toBe(100);
    expect(changed.find((x) => x.id === "b")?.weight).toBe(50);
    const back = removeBranch(three, "c");
    expect(sum(back)).toBe(100);
    expect(removeBranch(two, "a")).toBe(two);
  });

  it("A vs B: rates per row, too early under 30, leader by replies", () => {
    const res = abResults({ branches: two }, {
      a: { reached: 21, replied: 17, leadMagnet: 15, booked: 4, showed: 3 },
      b: { reached: 20, replied: 12, leadMagnet: 11, booked: 2, showed: 1 },
    });
    expect(res.rows.map((r) => r.label)).toEqual(["Reached", "Replied", "Lead magnet", "Booked", "Showed"]);
    expect(res.rows[1].cells.map((c) => c.pct)).toEqual(["81%", "60%"]);
    expect(res.rows[0].cells[0].bar).toBe(100);
    expect(res.verdict.kind).toBe("too_early");
    expect(res.note).toBe("Too early");
    expect(res.leaderId).toBe("a");
    expect(res.people).toBe(41);

    const big = abResults({ branches: two }, {
      a: { reached: 60, replied: 48, leadMagnet: 40, booked: 12, showed: 8 },
      b: { reached: 60, replied: 24, leadMagnet: 20, booked: 3, showed: 2 },
    });
    expect(big.verdict.kind).toBe("leader");
    expect(big.leaderId).toBe("a");
    expect(big.note).toBe("A gets replies 2×");
    expect(abResults({ branches: two }, {}).note).toBe("No one yet");
  });
});

describe("action, wait, setter, trigger", () => {
  it("action ops keep only the fields their op needs", () => {
    let ops = addOp([], "set_field");
    ops = updateOp(ops, 0, { key: "niche", value: "coaching" });
    expect(ops).toEqual([{ op: "set_field", key: "niche", value: "coaching" }]);
    expect(updateOp(ops, 0, { op: "friday" })).toEqual([{ op: "friday" }]);
    expect(updateOp(ops, 0, { op: "add_tag" })).toEqual([{ op: "add_tag", key: "niche" }]);
    expect(removeOp(ops, 0)).toEqual([{ op: "add_tag", key: "" }]);
  });

  it("durations parse and print; the 24h window warns", () => {
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1d 2h")).toBe(1560);
    expect(parseDuration("90")).toBe(90);
    expect(parseDuration("soon")).toBeNull();
    expect(formatMinutes(1440)).toBe("1d");
    expect(formatMinutes(90)).toBe("1h 30m");
    expect(waitWindowWarning({ mode: "delay", minutes: 60 })).toBeNull();
    expect(waitWindowWarning({ mode: "delay", minutes: 2 * 1440 })).toMatch(/approval/);
    expect(waitWindowWarning({ mode: "until_reply", timeoutMinutes: 8 * 1440 })).toMatch(/7 days/);
  });

  it("setter summary, release toggles, saves to", () => {
    const d = defaultData("setter") as StepData<"setter">;
    expect(setterSummary(d)).toBe("Book a call · Hold");
    expect(setterSummary({ ...d, goal: "start_conversation", leadMagnet: { mode: "none", resources: [] } })).toBe("Start a conversation");
    expect(toggleRelease(d, "quiet").release.quiet).toBe(false);
    const node: GraphNode = { id: "s", type: "setter", position: { x: 0, y: 0 }, data: { ...d, saveTo: ["niche", "email"] } };
    expect(savesTo(node)).toEqual(["niche", "email"]);
    expect(savesTo({ id: "a", type: "ask", position: { x: 0, y: 0 }, data: { question: "q", saveTo: "email", validate: "email" } })).toEqual(["email"]);
  });

  it("keywords are upper-cased and unique", () => {
    expect(parseKeywords("setter, Setter ,script\n")).toEqual(["SETTER", "SCRIPT"]);
  });

  it("port labels read like the canvas arrows", () => {
    const r: GraphNode = { id: "r", type: "randomizer", position: { x: 0, y: 0 }, data: defaultData("randomizer") };
    expect(portLabel(r, "branch:b")).toBe("B");
    expect(portLabel(r, "exit:not_a_fit")).toBe("Not a fit");
    expect(portLabel(r, "timeout")).toBe("No reply");
    expect(portLabel(r, "next")).toBe("");
  });
});

describe("Publish problems", () => {
  it("names the gaps in plain words, per step", () => {
    let g = emptyGraph();
    const m = addNode(g, "message", { x: 0, y: 0 });
    g = connect(m.graph, "trigger", "next", m.id);
    const go = addNode(g, "goto", { x: 0, y: 0 });
    g = go.graph;
    const p = friendlyProblems(g);
    expect(p).toContainEqual({ nodeId: "trigger", message: "Add a keyword" });
    expect(p).toContainEqual({ nodeId: m.id, message: "Empty bubble" });
    expect(p).toContainEqual({ nodeId: go.id, message: "Pick a workflow" });
    expect(p.filter((x) => x.nodeId === "trigger")).toHaveLength(1);
    expect(Object.keys(problemsByNode(p)).sort()).toEqual([go.id, m.id, "trigger"].sort());
  });
});

describe("line tests scope", () => {
  it("All of J hides workflow-only tests; This workflow shows only this workflow's", () => {
    const rows = [
      {
        key: "permission",
        tests: [
          { id: "1", scope: "setter" as const, workflowId: null },
          { id: "2", scope: "workflow" as const, workflowId: "wf1" },
          { id: "3", scope: "workflow" as const, workflowId: "wf2" },
        ],
      },
    ];
    expect(scopeLineRows(rows, "setter", "wf1")[0].tests.map((t) => t.id)).toEqual(["1"]);
    expect(scopeLineRows(rows, "workflow", "wf1")[0].tests.map((t) => t.id)).toEqual(["2"]);
  });
});

describe("numbers", () => {
  it("list funnel: % of the step before, bar vs triggered, — for no lead magnet", () => {
    const f = listFunnel({ triggered: 64, replied: 41, leadMagnet: 26, booked: 6, showed: 4 });
    expect(f.map((c) => c.pct)).toEqual(["", "64%", "63%", "23%"]);
    expect(f[1].bar).toBe(64);
    expect(listFunnel({ triggered: 21, replied: 17, leadMagnet: 0, booked: 3, showed: 0 })[2].n).toBe("—");
  });

  it("header strip and node stats", () => {
    expect(stripItems({ triggered: 64, replied: 41, leadMagnet: 26, booked: 6, showed: 4 }).map((s) => `${s.label} ${s.n} ${s.pct}`.trim())).toEqual([
      "Triggered 64",
      "Replied 41 64%",
      "Lead magnet 26 63%",
      "Booked 6 23%",
      "Showed 4 67%",
    ]);
    expect(nodeStatText({ reached: 41, share: 0.64 })).toEqual({ n: "41", pct: "64%" });
    expect(nodeStatText({ reached: 64, share: null })).toEqual({ n: "64", pct: "" });
    expect(nodeStatText(undefined)).toEqual({ n: "", pct: "" });
    expect(sinceLabel("2026-10-12")).toBe("Since 12 Oct");
  });
});

describe("mock adapter (OS_MOCK=1)", () => {
  it("lists the board's workflows, creates from a template, publishes with versions, pauses and resumes", async () => {
    const prev = process.env.OS_MOCK;
    process.env.OS_MOCK = "1";
    try {
      const data = await import("@/components/os/workflows/data");
      const rows = await data.listWorkflows("w");
      expect(rows.map((r) => r.name)).toContain("Hold the lead magnet");
      expect(rows.find((r) => r.name === "Hold the lead magnet")?.ab).toBe(true);

      const { id } = await data.createWorkflow("w", "simple", "script-vault");
      const wf = (await data.getWorkflow("w", id))!;
      expect(wf.mode).toBe("draft");
      expect(wf.version).toBeNull();
      // No keyword yet: blocked.
      const blocked = await data.publishWorkflow("w", id);
      expect("problems" in blocked && blocked.problems[0].message).toBe("Add a keyword");
      // A keyword that's live elsewhere: blocked (E12).
      const g = wf.graph;
      (g.nodes[0].data as StepData<"trigger">).keywords = ["SETTER"];
      await data.saveDraft("w", id, { graph: g });
      const clash = await data.publishWorkflow("w", id);
      expect("problems" in clash && clash.problems[0].message).toMatch(/already live/);
      (g.nodes[0].data as StepData<"trigger">).keywords = ["FRESH"];
      await data.saveDraft("w", id, { graph: g, name: "Fresh one" });
      expect(await data.publishWorkflow("w", id)).toEqual({ version: 1 });
      expect(await data.publishWorkflow("w", id)).toEqual({ version: 2 });
      expect((await data.getWorkflow("w", id))?.unpublished).toBe(false);
      await expect(data.saveDraft("w", id, { graph: { nope: true } })).rejects.toThrow();

      const run = await data.contactRun("w", "c1");
      expect(run).toMatchObject({ workflowName: "Hold the lead magnet", stepLabel: "Setter", status: "paused" });
      await data.resumeRun("w", "c1");
      expect((await data.contactRun("w", "c1"))?.status).toBe("active");
      expect(await data.contactRun("w", "nobody")).toBeNull();

      const stats = await data.workflowStats("w", "wf1");
      expect(stats?.strip.triggered).toBe(64);
      expect(stats?.nodes.trigger.reached).toBe(64);
      expect(Object.keys(stats?.branches.s2 ?? {})).toEqual(["a", "b"]);
    } finally {
      process.env.OS_MOCK = prev;
    }
  });

  it("without OS_MOCK the list is empty and writes say it isn't on yet", async () => {
    const prev = process.env.OS_MOCK;
    delete process.env.OS_MOCK;
    try {
      const data = await import("@/components/os/workflows/data");
      expect(await data.listWorkflows("w")).toEqual([]);
      await expect(data.createWorkflow("w", "blank")).rejects.toThrow(/switched on/);
    } finally {
      process.env.OS_MOCK = prev;
    }
  });
});
