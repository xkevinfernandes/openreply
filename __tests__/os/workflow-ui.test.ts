// Workflows builder (stream C2 wfcanvas): graph editing keeps validateGraph
// sane, the template picker's graphs, undo.

import { describe, expect, it } from "vitest";
import {
  addNode,
  commit,
  connect,
  connectProblem,
  defaultData,
  emptyGraph,
  historyOf,
  moveNode,
  pickBranchWinner,
  pruneEdges,
  redo,
  removeEdges,
  removeNodes,
  replace,
  undo,
  updateNodeData,
} from "@/components/os/workflows/graph-edit";
import { friendlyProblems } from "@/components/os/workflows/forms";
import { isTemplateKey, layoutGraph, templateGraph, TEMPLATE_KEYS, TEMPLATES } from "@/components/os/workflows/templates";
import { portsOf, STEP_DATA, STEP_TYPES, validateGraph, WorkflowGraph, type StepData } from "@/lib/os/workflows/graph";

function withKeyword(g: WorkflowGraph, kw = "SETTER"): WorkflowGraph {
  const t = g.nodes.find((n) => n.type === "trigger")!;
  return updateNodeData(g, t.id, { ...(t.data as StepData<"trigger">), keywords: [kw] });
}

describe("defaultData", () => {
  it("is valid for every step except the ones that need Kevin's input", () => {
    for (const type of STEP_TYPES) {
      // A trigger's empty keyword saves fine (Publish flags it); Go to's empty workflow is flagged by friendlyProblems.
      expect(STEP_DATA[type].safeParse(defaultData(type)).success, type).toBe(true);
    }
  });
});

describe("graph editing", () => {
  it("add + connect builds a publishable graph", () => {
    let g = withKeyword(emptyGraph());
    const m = addNode(g, "message", { x: 300, y: 80 }, { bubbles: [{ kind: "text", text: "hey" }] });
    g = m.graph;
    const end = addNode(g, "end", { x: 600, y: 80 });
    g = end.graph;
    g = connect(g, "trigger", "next", m.id);
    g = connect(g, m.id, "next", end.id);
    expect(validateGraph(g)).toEqual([]);
    expect(friendlyProblems(g)).toEqual([]);
  });

  it("gives new steps unique ids and never a second trigger", () => {
    let g = emptyGraph();
    const ids = new Set<string>();
    for (const t of ["message", "wait", "ask", "condition", "action", "randomizer", "setter", "goto", "end"] as const) {
      const r = addNode(g, t, { x: 0, y: 0 });
      ids.add(r.id);
      g = r.graph;
    }
    expect(ids.size).toBe(9);
    const again = addNode(g, "trigger", { x: 0, y: 0 });
    expect(again.graph.nodes.filter((n) => n.type === "trigger")).toHaveLength(1);
    expect(validateGraph(g).filter((p) => p.message.includes("Duplicate"))).toEqual([]);
  });

  it("refuses arrows into the trigger, to itself, or from a port the step doesn't have", () => {
    let g = emptyGraph();
    const m = addNode(g, "message", { x: 0, y: 0 });
    g = m.graph;
    expect(connectProblem(g, m.id, "next", "trigger")).toMatch(/trigger/);
    expect(connectProblem(g, m.id, "next", m.id)).toMatch(/itself/);
    expect(connectProblem(g, m.id, "yes", "trigger")).toBeTruthy();
    expect(connect(g, m.id, "next", "trigger")).toBe(g);
    expect(connect(g, m.id, "exit:booked", m.id)).toBe(g);
  });

  it("keeps one arrow per port: drawing again replaces it", () => {
    let g = emptyGraph();
    const a = addNode(g, "message", { x: 0, y: 0 });
    g = a.graph;
    const b = addNode(g, "end", { x: 0, y: 0 });
    g = b.graph;
    const c = addNode(g, "end", { x: 0, y: 0 });
    g = c.graph;
    g = connect(g, "trigger", "next", a.id);
    g = connect(g, a.id, "next", b.id);
    g = connect(g, a.id, "next", c.id);
    expect(g.edges.filter((e) => e.from === a.id)).toEqual([{ id: `${a.id}:next`, from: a.id, fromPort: "next", to: c.id }]);
    expect(validateGraph(g).some((p) => p.message.includes("same port"))).toBe(false);
  });

  it("connects every port portsOf gives (condition, randomizer, setter, wait, buttons)", () => {
    let g = emptyGraph();
    const end = addNode(g, "end", { x: 0, y: 0 });
    g = end.graph;
    for (const type of ["condition", "randomizer", "setter"] as const) {
      const r = addNode(g, type, { x: 0, y: 0 });
      g = r.graph;
      const node = g.nodes.find((n) => n.id === r.id)!;
      for (const p of portsOf(node)) g = connect(g, r.id, p, end.id);
      expect(g.edges.filter((e) => e.from === r.id)).toHaveLength(portsOf(node).length);
    }
    expect(validateGraph(withKeyword(g))).toEqual([]);
  });

  it("deleting a step removes its arrows; the trigger can't be deleted", () => {
    let g = withKeyword(templateGraph("send_link", "setter-starter"));
    const before = g.edges.length;
    g = removeNodes(g, ["link", "trigger"]);
    expect(g.nodes.some((n) => n.id === "trigger")).toBe(true);
    expect(g.nodes.some((n) => n.id === "link")).toBe(false);
    expect(g.edges.some((e) => e.from === "link" || e.to === "link")).toBe(false);
    expect(g.edges.length).toBe(before - 2);
    expect(validateGraph(g)).toEqual([]);
  });

  it("removing an arrow by id", () => {
    const g = templateGraph("send_link");
    const id = g.edges[0].id;
    expect(removeEdges(g, [id]).edges.find((e) => e.id === id)).toBeUndefined();
  });

  it("drops arrows from ports that vanish when a step changes", () => {
    let g = emptyGraph();
    const r = addNode(g, "randomizer", { x: 0, y: 0 });
    g = r.graph;
    const end = addNode(g, "end", { x: 0, y: 0 });
    g = end.graph;
    g = connect(g, r.id, "branch:a", end.id);
    g = connect(g, r.id, "branch:b", end.id);
    g = updateNodeData(g, r.id, { branches: [{ id: "a", label: "A", weight: 50 }, { id: "c", label: "C", weight: 50 }] });
    expect(g.edges.map((e) => e.fromPort)).toEqual(["branch:a"]);

    // Message: buttons replace "next".
    let h = emptyGraph();
    const m = addNode(h, "message", { x: 0, y: 0 });
    h = m.graph;
    const e2 = addNode(h, "end", { x: 0, y: 0 });
    h = connect(e2.graph, m.id, "next", e2.id);
    h = updateNodeData(h, m.id, { bubbles: [{ kind: "buttons", text: "want it?", buttons: [{ id: "b1", label: "Yes" }] }] });
    expect(h.edges.filter((e) => e.from === m.id)).toEqual([]);
    expect(pruneEdges(h)).toBe(h);
  });

  it("moves a step to rounded coordinates", () => {
    const g = moveNode(emptyGraph(), "trigger", { x: 10.6, y: 20.2 });
    expect(g.nodes[0].position).toEqual({ x: 11, y: 20 });
  });
});

describe("Pick winner", () => {
  function abGraph() {
    let g = withKeyword(emptyGraph());
    const msg = addNode(g, "message", { x: 0, y: 0 }, { bubbles: [{ kind: "text", text: "hi" }] });
    g = msg.graph;
    const rnd = addNode(g, "randomizer", { x: 0, y: 0 });
    g = rnd.graph;
    const a = addNode(g, "message", { x: 0, y: 0 }, { bubbles: [{ kind: "text", text: "A" }] });
    g = a.graph;
    const b = addNode(g, "message", { x: 0, y: 0 }, { bubbles: [{ kind: "text", text: "B" }] });
    g = b.graph;
    const bOnly = addNode(g, "wait", { x: 0, y: 0 });
    g = bOnly.graph;
    const setter = addNode(g, "setter", { x: 0, y: 0 });
    g = setter.graph;
    g = connect(g, "trigger", "next", msg.id);
    g = connect(g, msg.id, "next", rnd.id);
    g = connect(g, rnd.id, "branch:a", a.id);
    g = connect(g, rnd.id, "branch:b", b.id);
    g = connect(g, a.id, "next", setter.id);
    g = connect(g, b.id, "next", bOnly.id);
    g = connect(g, bOnly.id, "next", setter.id);
    return { g, msg: msg.id, rnd: rnd.id, a: a.id, b: b.id, bOnly: bOnly.id, setter: setter.id };
  }

  it("routes everyone down the winner and removes only the loser's own steps", () => {
    const { g, msg, rnd, a, b, bOnly, setter } = abGraph();
    const out = pickBranchWinner(g, rnd, "a");
    const ids = out.nodes.map((n) => n.id);
    expect(ids).not.toContain(rnd);
    expect(ids).not.toContain(b);
    expect(ids).not.toContain(bOnly);
    expect(ids).toContain(setter);
    expect(out.edges.find((e) => e.from === msg)?.to).toBe(a);
    expect(validateGraph(out)).toEqual([]);
  });

  it("is a no-op on a step that isn't a randomizer", () => {
    const { g, msg } = abGraph();
    expect(pickBranchWinner(g, msg, "a")).toBe(g);
  });
});

describe("undo", () => {
  it("commit, undo, redo; replace adds no step", () => {
    const g0 = emptyGraph();
    let h = historyOf(g0);
    const g1 = addNode(g0, "end", { x: 0, y: 0 }).graph;
    h = commit(h, g1);
    const g2 = moveNode(g1, "trigger", { x: 5, y: 5 });
    h = replace(h, g2);
    expect(h.past).toHaveLength(1);
    h = undo(h);
    expect(h.present).toBe(g0);
    h = redo(h);
    expect(h.present).toBe(g2);
    expect(undo(historyOf(g0)).present).toBe(g0);
    expect(commit(h, h.present)).toBe(h);
  });
});

describe("templates (New workflow picker)", () => {
  it("offers the starting points, Hold the lead magnet first and default", () => {
    expect(TEMPLATES.map((t) => t.label)).toEqual(["Hold the lead magnet", "Simple: send the link", "Start a conversation", "Waitlist + questions", "Blank"]);
    expect(TEMPLATES.find((t) => t.isDefault)?.key).toBe("hold_lead_magnet");
    expect(isTemplateKey("send_link")).toBe(true);
    expect(isTemplateKey("nope")).toBe(false);
  });

  it("every template starts with no keyword: it saves, and Publish asks for one at the trigger", () => {
    for (const k of TEMPLATE_KEYS) {
      const g = templateGraph(k, "setter-starter");
      const trigger = g.nodes.find((n) => n.type === "trigger")!;
      expect((trigger.data as StepData<"trigger">).keywords, k).toEqual([]);
      expect(WorkflowGraph.safeParse(g).success, k).toBe(true);
      expect(validateGraph(g), k).toEqual([{ nodeId: trigger.id, message: "Add a keyword" }]);
      const problems = friendlyProblems(g).map((p) => `${p.nodeId}:${p.message}`);
      if (k === "blank") expect(problems).toEqual(["trigger:Add a keyword", "trigger:Connect the trigger"]);
      else expect(problems, k).toEqual(["trigger:Add a keyword"]);
    }
  });

  it("every template is publishable once it has a keyword (Blank only needs an arrow)", () => {
    for (const k of TEMPLATE_KEYS) {
      const g = withKeyword(templateGraph(k, "setter-starter"));
      expect(validateGraph(g), k).toEqual([]);
      const problems = friendlyProblems(g);
      if (k === "blank") expect(problems.map((p) => p.message)).toEqual(["Connect the trigger"]);
      else expect(problems, k).toEqual([]);
    }
  });

  it("Hold = Book a call + Hold until release, with the lead magnet filled in", () => {
    const setter = templateGraph("hold_lead_magnet", "setter-starter").nodes.find((n) => n.type === "setter")!.data as StepData<"setter">;
    expect(setter.goal).toBe("book_call");
    expect(setter.leadMagnet).toEqual({ mode: "hold", resources: ["setter-starter"] });
    expect(Object.values(setter.release).every(Boolean)).toBe(true);
  });

  it("Simple sends the link as its own bubble; Start a conversation has J with that goal", () => {
    const g = templateGraph("send_link", "script-vault");
    const link = g.nodes.find((n) => n.type === "message" && (n.data as StepData<"message">).bubbles.some((b) => b.kind === "link"))!.data as StepData<"message">;
    expect(link.bubbles.map((b) => b.kind)).toEqual(["text", "link"]);
    expect(link.bubbles[1]).toEqual({ kind: "link", resourceSlug: "script-vault" });
    const conv = templateGraph("start_conversation").nodes.find((n) => n.type === "setter")!.data as StepData<"setter">;
    expect(conv.goal).toBe("start_conversation");
  });

  it("lays steps out left to right along the arrows", () => {
    const g = templateGraph("hold_lead_magnet");
    const x = (id: string) => g.nodes.find((n) => n.id === id)!.position.x;
    for (const e of g.edges) expect(x(e.to), `${e.from}→${e.to}`).toBeGreaterThan(x(e.from));
    const orphan = layoutGraph({ ...g, edges: [] });
    expect(new Set(orphan.nodes.filter((n) => n.type !== "trigger").map((n) => n.position.x)).size).toBe(1);
  });

  it("returns a fresh graph each time (editing one never changes the next)", () => {
    const a = templateGraph("hold_lead_magnet");
    a.nodes[0].position.x = 999;
    expect(templateGraph("hold_lead_magnet").nodes[0].position.x).toBe(0);
  });
});
