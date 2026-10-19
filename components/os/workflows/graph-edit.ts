// Pure graph editing for the Workflows canvas: add, connect, move, edit,
// delete, Pick winner, undo. The canvas only ever changes the graph through
// these, so every edit keeps the shape validateGraph expects (one arrow per
// port, no arrow into the trigger, no dangling arrows). Contract:
// lib/os/workflows/graph.ts (read-only here).

import { portsOf, type GraphEdge, type GraphNode, type StepData, type StepType, type WorkflowGraph } from "@/lib/os/workflows/graph";

export type Pos = { x: number; y: number };

/** A fresh step's settings: valid where a sensible default exists. */
export function defaultData(type: StepType): unknown {
  switch (type) {
    case "trigger":
      return { kind: "comment", keywords: [], postIds: "any", publicReplies: [], reentry: { mode: "after_days", days: 30 } } satisfies StepData<"trigger">;
    case "message":
      return { bubbles: [{ kind: "text", text: "" }] } satisfies StepData<"message">;
    case "wait":
      return { mode: "until_reply", timeoutMinutes: 1440 } satisfies StepData<"wait">;
    case "ask":
      return { question: "", saveTo: "email", validate: "email" } satisfies StepData<"ask">;
    case "condition":
      return { rule: { kind: "follows" } } satisfies StepData<"condition">;
    case "action":
      return { ops: [{ op: "add_tag", key: "" }] } satisfies StepData<"action">;
    case "randomizer":
      return {
        branches: [
          { id: "a", label: "A", weight: 50 },
          { id: "b", label: "B", weight: 50 },
        ],
      } satisfies StepData<"randomizer">;
    case "setter":
      return {
        goal: "book_call",
        leadMagnet: { mode: "hold", resources: [] },
        release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true },
        quietHours: [18, 22],
        saveTo: [],
      } satisfies StepData<"setter">;
    case "goto":
      return { workflowId: "" } satisfies StepData<"goto">;
    case "end":
      return {} satisfies StepData<"end">;
  }
}

export function emptyGraph(): WorkflowGraph {
  return { version: 1, nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 80 }, data: defaultData("trigger") }], edges: [] };
}

/** A short id not used yet: s1, s2, … */
export function nextId(graph: WorkflowGraph, prefix = "s"): string {
  const taken = new Set(graph.nodes.map((n) => n.id));
  for (let i = graph.nodes.length + 1; ; i++) if (!taken.has(`${prefix}${i}`)) return `${prefix}${i}`;
}

export const edgeId = (from: string, port: string) => `${from}:${port}`;

export function addNode(graph: WorkflowGraph, type: StepType, position: Pos, data?: unknown): { graph: WorkflowGraph; id: string } {
  if (type === "trigger" && graph.nodes.some((n) => n.type === "trigger")) return { graph, id: graph.nodes.find((n) => n.type === "trigger")!.id };
  const id = nextId(graph);
  const node: GraphNode = { id, type, position: { x: Math.round(position.x), y: Math.round(position.y) }, data: data ?? defaultData(type) };
  return { graph: { ...graph, nodes: [...graph.nodes, node] }, id };
}

export function nodeById(graph: WorkflowGraph, id: string | null | undefined): GraphNode | undefined {
  return id ? graph.nodes.find((n) => n.id === id) : undefined;
}

function safePorts(node: GraphNode): string[] {
  try {
    return portsOf(node);
  } catch {
    return [];
  }
}

/** Why an arrow can't be drawn, or null when it can. */
export function connectProblem(graph: WorkflowGraph, from: string, port: string, to: string): string | null {
  const a = nodeById(graph, from);
  const b = nodeById(graph, to);
  if (!a || !b) return "Missing step";
  if (from === to) return "A step can't point at itself";
  if (b.type === "trigger") return "Nothing can point at the trigger";
  if (!safePorts(a).includes(port)) return "That step has no such exit";
  return null;
}

/** Draw an arrow. A port has one arrow: drawing again replaces it. */
export function connect(graph: WorkflowGraph, from: string, port: string, to: string): WorkflowGraph {
  if (connectProblem(graph, from, port, to)) return graph;
  const id = edgeId(from, port);
  const edges = graph.edges.filter((e) => !(e.from === from && e.fromPort === port));
  return { ...graph, edges: [...edges, { id, from, fromPort: port, to }] };
}

export function removeEdges(graph: WorkflowGraph, ids: string[]): WorkflowGraph {
  const drop = new Set(ids);
  return { ...graph, edges: graph.edges.filter((e) => !drop.has(e.id)) };
}

/** Delete steps and their arrows. The trigger can't be deleted. */
export function removeNodes(graph: WorkflowGraph, ids: string[]): WorkflowGraph {
  const drop = new Set(ids.filter((id) => nodeById(graph, id)?.type !== "trigger"));
  if (!drop.size) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !drop.has(n.id)),
    edges: graph.edges.filter((e) => !drop.has(e.from) && !drop.has(e.to)),
  };
}

export function moveNode(graph: WorkflowGraph, id: string, position: Pos): WorkflowGraph {
  return { ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, position: { x: Math.round(position.x), y: Math.round(position.y) } } : n)) };
}

/** Arrows from ports that no longer exist (a removed button or branch) go. */
export function pruneEdges(graph: WorkflowGraph): WorkflowGraph {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const edges = graph.edges.filter((e) => {
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    return from && to && to.type !== "trigger" && safePorts(from).includes(e.fromPort);
  });
  return edges.length === graph.edges.length ? graph : { ...graph, edges };
}

/** Change a step's settings; arrows from vanished ports are dropped. */
export function updateNodeData(graph: WorkflowGraph, id: string, data: unknown): WorkflowGraph {
  return pruneEdges({ ...graph, nodes: graph.nodes.map((n) => (n.id === id ? { ...n, data } : n)) });
}

/** The step an arrow from this port points at. */
export function targetOf(graph: WorkflowGraph, from: string, port: string): string | null {
  return graph.edges.find((e) => e.from === from && e.fromPort === port)?.to ?? null;
}

function reachable(graph: WorkflowGraph, starts: string[]): Set<string> {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of graph.edges) if (e.from === id) stack.push(e.to);
  }
  return seen;
}

/**
 * Randomizer › Pick winner: everyone goes down the winning branch. The
 * randomizer is replaced by a straight arrow to the winner's step, and the
 * steps only the losing branches led to are removed.
 */
export function pickBranchWinner(graph: WorkflowGraph, nodeId: string, branchId: string): WorkflowGraph {
  const node = nodeById(graph, nodeId);
  if (!node || node.type !== "randomizer") return graph;
  const winner = targetOf(graph, nodeId, `branch:${branchId}`);
  const losers = graph.edges.filter((e) => e.from === nodeId && e.fromPort !== `branch:${branchId}`).map((e) => e.to);
  const incoming = graph.edges.filter((e) => e.to === nodeId);
  let g: WorkflowGraph = {
    ...graph,
    nodes: graph.nodes.filter((n) => n.id !== nodeId),
    edges: graph.edges.filter((e) => e.from !== nodeId && e.to !== nodeId),
  };
  if (winner) for (const e of incoming) g = connect(g, e.from, e.fromPort, winner);
  const trigger = g.nodes.find((n) => n.type === "trigger");
  const live = reachable(g, trigger ? [trigger.id] : []);
  const loserTree = reachable(g, losers);
  const drop = [...loserTree].filter((id) => !live.has(id));
  return removeNodes(g, drop);
}

// ---------------------------------------------------------------- undo
export interface History {
  past: WorkflowGraph[];
  present: WorkflowGraph;
  future: WorkflowGraph[];
}

const MAX_UNDO = 60;

export const historyOf = (graph: WorkflowGraph): History => ({ past: [], present: graph, future: [] });

/** Record an edit. Same graph = no new step. */
export function commit(h: History, next: WorkflowGraph): History {
  if (next === h.present) return h;
  return { past: [...h.past, h.present].slice(-MAX_UNDO), present: next, future: [] };
}

/** Replace without an undo step (a drag in progress). */
export function replace(h: History, next: WorkflowGraph): History {
  return next === h.present ? h : { ...h, present: next };
}

export function undo(h: History): History {
  if (!h.past.length) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future] };
}

export function redo(h: History): History {
  if (!h.future.length) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1) };
}

export type { GraphEdge, GraphNode, WorkflowGraph };
