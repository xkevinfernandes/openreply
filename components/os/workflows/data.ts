// The Workflows screens' data adapter (server only).
//
// TODO(wfengine): the engine stream owns the real store and API
// (lib/os/workflows/api.ts + prisma/os-workflows.prisma). When it lands,
// replace the bodies below with calls to it; the exported signatures are the
// ones the screens use. Until then:
//  - OS_MOCK=1: an in-memory store seeded with the WorkflowsList board's four
//    workflows, per-step stats and two runs (maya.builds paused, tom.k active).
//  - otherwise: an empty list, and writes say workflows aren't switched on yet.

import { friendlyProblems, STEP_LABEL } from "@/components/os/workflows/forms";
import { templateGraph, TEMPLATES, type TemplateKey } from "@/components/os/workflows/templates";
import type { ContactRun, FunnelStrip, NodeStat, Period, WorkflowDetail, WorkflowMode, WorkflowRow, WorkflowStats } from "@/components/os/workflows/types";
import { osMockEnabled } from "@/lib/os/mock";
import { WorkflowGraph, type GraphProblem, type StepData } from "@/lib/os/workflows/graph";

export class WorkflowsUnavailable extends Error {
  constructor() {
    super("Workflows aren't switched on yet.");
  }
}

interface StoredWorkflow {
  id: string;
  name: string;
  mode: WorkflowMode;
  on: boolean;
  draft: WorkflowGraph;
  versions: { version: number; graph: WorkflowGraph; at: string }[];
  updatedAt: string;
  triggered: number;
}

interface Store {
  workflows: Map<string, StoredWorkflow>;
  runs: Map<string, { workflowId: string; stepId: string; status: "active" | "paused" }>;
  seq: number;
}

const g = globalThis as typeof globalThis & { __osWorkflows?: Store };

function store(): Store {
  if (!osMockEnabled()) throw new WorkflowsUnavailable();
  if (!g.__osWorkflows) g.__osWorkflows = seed();
  return g.__osWorkflows;
}

const now = () => new Date().toISOString();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- reads
export async function listWorkflows(_workspaceId: string): Promise<WorkflowRow[]> {
  if (!osMockEnabled()) return [];
  return [...store().workflows.values()].map((w) => {
    const graph = w.versions.at(-1)?.graph ?? w.draft;
    const trig = graph.nodes.find((n) => n.type === "trigger")?.data as StepData<"trigger"> | undefined;
    const stats = computeStats(w);
    return {
      id: w.id,
      name: w.name,
      trigger: { kind: trig?.kind ?? "comment", keywords: trig?.keywords ?? [] },
      mode: w.mode,
      on: w.on,
      ab: graph.nodes.some((n) => n.type === "randomizer"),
      funnel: stats.strip,
      version: w.versions.at(-1)?.version ?? null,
    };
  });
}

export async function getWorkflow(_workspaceId: string, id: string): Promise<WorkflowDetail | null> {
  if (!osMockEnabled()) return null;
  const w = store().workflows.get(id);
  if (!w) return null;
  const published = w.versions.at(-1)?.graph;
  return {
    id: w.id,
    name: w.name,
    mode: w.mode,
    on: w.on,
    graph: clone(w.draft),
    version: w.versions.at(-1)?.version ?? null,
    unpublished: !published || !same(published, w.draft),
    updatedAt: w.updatedAt,
  };
}

export async function workflowStats(_workspaceId: string, id: string, _period: Period = "all"): Promise<WorkflowStats | null> {
  if (!osMockEnabled()) return null;
  const w = store().workflows.get(id);
  return w ? computeStats(w) : null;
}

/** For the Go to picker. */
export async function workflowNames(workspaceId: string): Promise<{ id: string; name: string }[]> {
  return (await listWorkflows(workspaceId)).map((w) => ({ id: w.id, name: w.name }));
}

// ---------------------------------------------------------------- writes
export async function createWorkflow(_workspaceId: string, template: TemplateKey, resourceSlug?: string): Promise<{ id: string }> {
  const s = store();
  const t = TEMPLATES.find((x) => x.key === template)!;
  const id = `wf${++s.seq}`;
  const taken = new Set([...s.workflows.values()].map((w) => w.name));
  let name = t.name;
  for (let i = 2; taken.has(name); i++) name = `${t.name} ${i}`;
  s.workflows.set(id, { id, name, mode: "draft", on: false, draft: templateGraph(template, resourceSlug), versions: [], updatedAt: now(), triggered: 0 });
  return { id };
}

export async function saveDraft(_workspaceId: string, id: string, input: { graph?: unknown; name?: string }): Promise<{ savedAt: string }> {
  const w = store().workflows.get(id);
  if (!w) throw new Error("That workflow is gone. Refresh the page.");
  if (input.graph !== undefined) {
    const parsed = WorkflowGraph.safeParse(input.graph);
    if (!parsed.success) throw new Error("That didn't save: the workflow looks broken. Undo the last change.");
    w.draft = parsed.data;
  }
  if (input.name !== undefined) w.name = input.name.trim().slice(0, 80) || w.name;
  w.updatedAt = now();
  return { savedAt: w.updatedAt };
}

/** Publish the draft as a new version, unless something blocks it. */
export async function publishWorkflow(_workspaceId: string, id: string): Promise<{ version: number } | { problems: GraphProblem[] }> {
  const w = store().workflows.get(id);
  if (!w) throw new Error("That workflow is gone. Refresh the page.");
  const problems = friendlyProblems(w.draft);
  if (problems.length) return { problems };
  const clash = keywordClash(w);
  if (clash) return { problems: [{ nodeId: w.draft.nodes.find((n) => n.type === "trigger")?.id, message: clash }] };
  const version = (w.versions.at(-1)?.version ?? 0) + 1;
  w.versions.push({ version, graph: clone(w.draft), at: now() });
  w.on = true;
  w.updatedAt = now();
  return { version };
}

/** E12: one keyword lives in one live workflow. */
function keywordClash(w: StoredWorkflow): string | null {
  const mine = (w.draft.nodes.find((n) => n.type === "trigger")?.data as StepData<"trigger"> | undefined)?.keywords ?? [];
  for (const other of store().workflows.values()) {
    if (other.id === w.id || !other.on) continue;
    const graph = other.versions.at(-1)?.graph;
    const theirs = (graph?.nodes.find((n) => n.type === "trigger")?.data as StepData<"trigger"> | undefined)?.keywords ?? [];
    const hit = mine.find((k) => theirs.includes(k));
    if (hit) return `${hit} is already live in ${other.name}`;
  }
  return null;
}

export async function setMode(_workspaceId: string, id: string, mode: WorkflowMode): Promise<void> {
  const w = store().workflows.get(id);
  if (!w) throw new Error("That workflow is gone. Refresh the page.");
  w.mode = mode;
}

export async function setOn(_workspaceId: string, id: string, on: boolean): Promise<void> {
  const w = store().workflows.get(id);
  if (!w) throw new Error("That workflow is gone. Refresh the page.");
  if (on && !w.versions.length) throw new Error("Publish it first.");
  w.on = on;
}

export async function deleteWorkflow(_workspaceId: string, id: string): Promise<void> {
  store().workflows.delete(id);
}

// ---------------------------------------------------------------- runs (Inbox)
export async function contactRun(_workspaceId: string, contactId: string): Promise<ContactRun | null> {
  if (!osMockEnabled()) return null;
  const s = store();
  const r = s.runs.get(contactId);
  const w = r && s.workflows.get(r.workflowId);
  if (!r || !w) return null;
  const node = (w.versions.at(-1)?.graph ?? w.draft).nodes.find((n) => n.id === r.stepId);
  return { workflowId: w.id, workflowName: w.name, stepId: r.stepId, stepLabel: node ? STEP_LABEL[node.type] : "Step", status: r.status };
}

export async function pauseRun(_workspaceId: string, contactId: string): Promise<void> {
  const r = store().runs.get(contactId);
  if (r) r.status = "paused";
}

/** K2: J reads what Kevin wrote and carries on; timers restart from now. */
export async function resumeRun(_workspaceId: string, contactId: string): Promise<void> {
  const r = store().runs.get(contactId);
  if (!r) throw new Error("Nothing to resume.");
  r.status = "active";
}

// ---------------------------------------------------------------- mock stats
/**
 * Plausible numbers walked down the graph from the trigger: each step keeps
 * a fixed share of the step before, a randomizer splits by weight, a setter
 * spreads its people over its exits. Deterministic, so pages agree.
 */
function computeStats(w: StoredWorkflow): WorkflowStats {
  const graph = w.draft;
  const nodes: Record<string, NodeStat> = {};
  const ports: WorkflowStats["ports"] = {};
  const releases: WorkflowStats["releases"] = {};
  const branches: WorkflowStats["branches"] = {};
  const trigger = graph.nodes.find((n) => n.type === "trigger");
  const strip: FunnelStrip = { triggered: w.triggered, replied: 0, leadMagnet: 0, booked: 0, showed: 0 };
  if (!trigger || !w.triggered) return { strip, since: null, nodes, ports, releases, branches };

  const keep: Partial<Record<string, number>> = { message: 0.64, wait: 0.9, ask: 0.35, condition: 1, action: 1, setter: 1, goto: 1, end: 1 };
  const visit = (id: string, people: number, prev: number | null, depth: number) => {
    const node = graph.nodes.find((n) => n.id === id);
    if (!node || depth > 30) return;
    const reached = prev === null ? people : Math.round(people);
    const before = nodes[id]?.reached ?? 0;
    nodes[id] = { reached: before + reached, share: prev ? Math.min(1, (before + reached) / prev) : null };
    const out = graph.edges.filter((e) => e.from === id);
    const send = (port: string, n: number) => {
      (ports[id] ??= {})[port] = ((ports[id] ?? {})[port] ?? 0) + n;
      const e = out.find((x) => x.fromPort === port);
      if (e) {
        const next = graph.nodes.find((x) => x.id === e.to);
        visit(e.to, Math.round(n * (keep[next?.type ?? "end"] ?? 1)), reached, depth + 1);
      }
    };
    if (node.type === "randomizer") {
      const d = node.data as StepData<"randomizer">;
      const total = d.branches.reduce((s, b) => s + b.weight, 0) || 1;
      let left = reached;
      d.branches.forEach((b, i) => {
        const n = i === d.branches.length - 1 ? left : Math.round((reached * b.weight) / total);
        left -= n;
        const lift = i === 0 ? 1 : 0.74;
        const replied = Math.round(n * 0.81 * lift);
        const lm = Math.round(replied * 0.88);
        const booked = Math.round(lm * 0.27 * lift);
        (branches[id] ??= {})[b.id] = { reached: n, replied, leadMagnet: lm, booked, showed: Math.round(booked * 0.7) };
        send(`branch:${b.id}`, n);
      });
    } else if (node.type === "setter") {
      const d = node.data as StepData<"setter">;
      const booked = Math.round(reached * 0.15);
      const quiet = Math.round(reached * 0.29);
      const notFit = Math.round(reached * 0.07);
      const stopped = Math.round(reached * 0.02);
      strip.booked += booked;
      strip.showed += Math.round(booked * 0.67);
      if (d.leadMagnet.mode !== "none") {
        const rel = { booked: d.release.booked ? booked : 0, quiet: d.release.quiet ? quiet : 0, notReady: d.release.notReady ? Math.round(reached * 0.2) : 0, askedTwice: 0, notFit: d.release.notFit ? notFit : 0 };
        releases[id] = rel;
        strip.leadMagnet += Object.values(rel).reduce((s, n) => s + n, 0);
      }
      send("exit:booked", booked);
      send("exit:quiet", quiet);
      send("exit:not_a_fit", notFit);
      send("exit:stopped", stopped);
      if (d.goal === "start_conversation") send("exit:goal_met", Math.round(reached * 0.4));
    } else if (node.type === "condition") {
      send("yes", Math.round(reached * 0.7));
      send("no", reached - Math.round(reached * 0.7));
    } else if (node.type === "message") {
      if (prev !== null && depth === 1) strip.replied += reached;
      const d = node.data as StepData<"message">;
      if (d.bubbles.some((b) => b.kind === "link")) strip.leadMagnet += reached;
      const portsHere = d.bubbles.flatMap((b) => (b.kind === "buttons" ? b.buttons.map((x) => `button:${x.id}`) : []));
      if (portsHere.length) portsHere.forEach((p, i) => send(p, Math.round(reached / (i + 2))));
      else send("next", reached);
    } else if (node.type === "wait") {
      const d = node.data as StepData<"wait">;
      const timeout = d.mode === "delay" ? 0 : Math.round(reached * 0.3);
      send("next", reached - timeout);
      if (timeout) send("timeout", timeout);
    } else if (node.type !== "end" && node.type !== "goto") {
      send("next", reached);
    }
  };
  visit(trigger.id, w.triggered, null, 0);
  if (!strip.replied) strip.replied = Math.round(w.triggered * 0.64);
  return { strip, since: "2026-10-12", nodes, ports, releases, branches };
}

// ---------------------------------------------------------------- mock seed
function seed(): Store {
  const at = "2026-10-12T09:00:00.000Z";
  const hold = templateGraph("hold", "setter-starter");
  // The board's Hold the lead magnet: opener → Randomizer → A/B opener → J.
  hold.nodes = [
    { id: "trigger", type: "trigger", position: { x: 0, y: 60 }, data: { kind: "comment", keywords: ["SETTER"], postIds: "any", publicReplies: ["sent it to your DMs", "just sent it over", "check your DMs"], reentry: { mode: "after_days", days: 30 } } },
    { id: "s1", type: "message", position: { x: 280, y: 40 }, data: { bubbles: [{ kind: "text", text: "hey {first_name}! caught your comment, want me to drop it below?" }, { kind: "text", text: "got a couple of versions so I send the right one, are you doing DMs yourself or with a team?" }] } },
    { id: "s2", type: "randomizer", position: { x: 560, y: 60 }, data: { branches: [{ id: "a", label: "A", weight: 50 }, { id: "b", label: "B", weight: 50 }] } },
    { id: "s3", type: "message", position: { x: 820, y: -40 }, data: { bubbles: [{ kind: "text", text: "what's slowing your DMs down most right now?" }] } },
    { id: "s4", type: "message", position: { x: 820, y: 160 }, data: { bubbles: [{ kind: "text", text: "how are you handling DMs right now?" }] } },
    { id: "s5", type: "setter", position: { x: 1100, y: 40 }, data: { goal: "book_call", leadMagnet: { mode: "hold", resources: ["setter-starter"], second: "script-vault" }, release: { booked: true, quiet: true, notReady: true, askedTwice: true, notFit: true }, quietHours: [18, 22], saveTo: ["niche", "monthly_revenue", "their_goal"] } },
    { id: "s6", type: "action", position: { x: 1400, y: 160 }, data: { ops: [{ op: "add_tag", key: "ghosted" }, { op: "friday" }] } },
    { id: "s7", type: "ask", position: { x: 1400, y: -60 }, data: { question: "what's the best email for extras?", saveTo: "email", validate: "email", retry: "hmm that doesn't look right, mind checking it?" } },
    { id: "s8", type: "end", position: { x: 1680, y: 60 }, data: {} },
  ];
  hold.edges = [
    { id: "trigger:next", from: "trigger", fromPort: "next", to: "s1" },
    { id: "s1:next", from: "s1", fromPort: "next", to: "s2" },
    { id: "s2:branch:a", from: "s2", fromPort: "branch:a", to: "s3" },
    { id: "s2:branch:b", from: "s2", fromPort: "branch:b", to: "s4" },
    { id: "s3:next", from: "s3", fromPort: "next", to: "s5" },
    { id: "s4:next", from: "s4", fromPort: "next", to: "s5" },
    { id: "s5:exit:booked", from: "s5", fromPort: "exit:booked", to: "s7" },
    { id: "s5:exit:quiet", from: "s5", fromPort: "exit:quiet", to: "s6" },
    { id: "s6:next", from: "s6", fromPort: "next", to: "s8" },
    { id: "s7:next", from: "s7", fromPort: "next", to: "s8" },
  ];

  const vault = templateGraph("simple", "script-vault");
  (vault.nodes[0].data as StepData<"trigger">).kind = "story_reply";
  (vault.nodes[0].data as StepData<"trigger">).keywords = ["SCRIPT"];
  (vault.nodes[0].data as StepData<"trigger">).publicReplies = [];

  const hello = templateGraph("conversation");
  (hello.nodes[0].data as StepData<"trigger">).keywords = ["CLAUDE", "HELP"];

  const carousel = clone(hold);
  (carousel.nodes[0].data as StepData<"trigger">).keywords = ["STARTER"];

  const rows: StoredWorkflow[] = [
    { id: "wf1", name: "Hold the lead magnet", mode: "draft", on: true, draft: hold, versions: [{ version: 3, graph: clone(hold), at }], updatedAt: at, triggered: 64 },
    { id: "wf2", name: "Script Vault", mode: "auto", on: true, draft: vault, versions: [{ version: 1, graph: clone(vault), at }], updatedAt: at, triggered: 38 },
    { id: "wf3", name: "Inbound hello", mode: "auto", on: true, draft: hello, versions: [{ version: 2, graph: clone(hello), at }], updatedAt: at, triggered: 21 },
    { id: "wf4", name: "Carousel starter", mode: "draft", on: true, draft: carousel, versions: [{ version: 1, graph: clone(carousel), at }], updatedAt: at, triggered: 12 },
  ];
  return {
    workflows: new Map(rows.map((r) => [r.id, r])),
    runs: new Map([
      ["c1", { workflowId: "wf1", stepId: "s5", status: "paused" as const }],
      ["c2", { workflowId: "wf1", stepId: "s1", status: "active" as const }],
      ["c3", { workflowId: "wf1", stepId: "s5", status: "active" as const }],
    ]),
    seq: rows.length,
  };
}
