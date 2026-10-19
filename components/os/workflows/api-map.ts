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
  };
}

export function detailFromApi(d: Api.WorkflowDetail): WorkflowDetail {
  return { id: d.id, name: d.name, mode: d.mode, on: d.active, graph: d.draft, version: d.version, unpublished: d.unpublished, updatedAt: d.updatedAt };
}

/** pctOfPrev may come as 0..100 or 0..1; the canvas wants a 0..1 share. */
function share(p: number | null): number | null {
  if (p === null || p === undefined || !Number.isFinite(p)) return null;
  return p > 1 ? p / 100 : p;
}

export function statsFromApi(s: Api.WorkflowStats, since: string | null = null): WorkflowStats {
  const nodes: WorkflowStats["nodes"] = {};
  const releases: WorkflowStats["releases"] = {};
  for (const [id, n] of Object.entries(s.nodes)) {
    nodes[id] = { reached: n.reached, share: share(n.pctOfPrev) };
    // TODO(wfengine): releases per rule; only the total comes back today.
    if (n.setter) releases[id] = {};
  }
  // "<nodeId>:<port>" → {nodeId: {port: n}}. Node ids never contain ":".
  const ports: WorkflowStats["ports"] = {};
  for (const [key, n] of Object.entries(s.ports)) {
    const i = key.indexOf(":");
    if (i < 0) continue;
    (ports[key.slice(0, i)] ??= {})[key.slice(i + 1)] = n;
  }
  // TODO(wfengine): the full funnel per randomizer branch. Until then only
  // Reached is known (people who left by the branch arrow).
  const branches: WorkflowStats["branches"] = {};
  for (const [nodeId, byPort] of Object.entries(ports)) {
    for (const [port, n] of Object.entries(byPort)) {
      if (!port.startsWith("branch:")) continue;
      (branches[nodeId] ??= {})[port.slice(7)] = { reached: n, replied: 0, leadMagnet: 0, booked: 0, showed: 0 };
    }
  }
  return { strip: s.header, since, nodes, ports, releases, branches };
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
