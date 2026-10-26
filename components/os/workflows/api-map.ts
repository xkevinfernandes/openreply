// Pure mapping from the engine API (lib/os/workflows/api.ts, stream wfengine)
// to what the Workflows screens read (types.ts).

import { STEP_LABEL } from "@/components/os/workflows/forms";
import type { ContactRun, FunnelStrip, WorkflowDetail, WorkflowRow, WorkflowStats } from "@/components/os/workflows/types";
import type * as Api from "@/lib/os/workflows/api";
import type { GraphProblem, WorkflowGraph } from "@/lib/os/workflows/graph";

const EMPTY: FunnelStrip = { triggered: 0, replied: 0, leadMagnet: 0, booked: 0, showed: 0 };

export function rowFromSummary(s: Api.WorkflowSummary, stats: Api.WorkflowStats | null, ab: boolean): WorkflowRow {
  return {
    id: s.id,
    name: s.name,
    trigger: { kind: s.trigger?.kind ?? "comment", keywords: s.trigger?.keywords ?? [] },
    mode: s.mode,
    on: s.active,
    ab,
    funnel: stats?.header ?? EMPTY,
    version: s.version,
    unpublished: s.unpublished,
    live: s.runs.active + s.runs.paused,
  };
}

export function detailFromApi(d: Api.WorkflowDetail): WorkflowDetail {
  return { id: d.id, name: d.name, mode: d.mode, on: d.active, graph: d.draft, version: d.version, unpublished: d.unpublished, updatedAt: d.updatedAt, live: d.runs.active + d.runs.paused };
}

export function statsFromApi(s: Api.WorkflowStats, since: string | null = null): WorkflowStats {
  const nodes: WorkflowStats["nodes"] = {};
  const releases: WorkflowStats["releases"] = {};
  const branches: WorkflowStats["branches"] = {};
  for (const [id, n] of Object.entries(s.nodes)) {
    nodes[id] = { reached: n.reached, share: n.pctOfPrev };
    if (n.setter) releases[id] = { ...n.setter.releasedBy };
    if (n.branches) branches[id] = { ...n.branches };
  }
  // "<nodeId>:<port>" → {nodeId: {port: n}}. Node ids never contain ":".
  const ports: WorkflowStats["ports"] = {};
  for (const [key, n] of Object.entries(s.ports)) {
    const i = key.indexOf(":");
    if (i < 0) continue;
    (ports[key.slice(0, i)] ??= {})[key.slice(i + 1)] = n;
  }
  return { strip: s.header, since, nodes, ports, releases, branches, byReel: (s.byReel ?? []).map((r) => ({ ...r })) };
}

/** The Inbox line shows live runs only: active/waiting = Active, paused = Paused. */
export function runFromApi(r: Api.ContactRunView | null): ContactRun | null {
  if (!r) return null;
  const status = r.status === "paused" ? "paused" : r.status === "active" || r.status === "waiting" ? "active" : null;
  if (!status) return null;
  return { workflowId: r.workflowId, workflowName: r.workflowName, stepId: r.nodeId ?? "", stepLabel: r.nodeType ? STEP_LABEL[r.nodeType] : "Step", status };
}

/** Publish refusals as problems on the canvas (clashes sit on the trigger). */
export function publishProblems(r: Extract<Api.PublishResult, { ok: false }>, graph: WorkflowGraph): GraphProblem[] {
  const trigger = graph.nodes.find((n) => n.type === "trigger")?.id;
  const out: GraphProblem[] = [...r.problems];
  for (const c of r.clashes ?? []) out.push({ nodeId: trigger, message: `${c.keyword} is already live in ${c.name}` });
  for (const w of r.waiting ?? [])
    out.push({ message: `${w.count} ${w.count === 1 ? "person waits" : "people wait"} on a removed step. Put it back for now.` });
  if (!out.length) out.push({ message: r.error });
  return out;
}
