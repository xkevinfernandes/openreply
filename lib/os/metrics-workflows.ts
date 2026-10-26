// Home's workflow numbers: runs started → replied → emails captured →
// finished → qualified over the selected period, from WorkflowRun and
// WorkflowRunEvent (the same events as the canvas stats, lib/os/workflows/stats.ts).
// They also top up the outcome row (lib/os/metrics.ts), whose OsEvent log
// only hears campaigns (DmLog) and J, so Home is never empty while workflows run.
// Pure helpers first (tested), loader at the bottom.

import { prisma } from "@/lib/db/client";
import type { OsEventKind } from "@/lib/os/events";
import { STEP_DATA, WorkflowGraph } from "@/lib/os/workflows/graph";

export interface WfRunLite {
  id: string;
  contactId: string | null;
  versionId: string;
  startedAt: Date;
  endedAt: Date | null;
  status: string;
  exit: string | null;
}

export interface WfEventLite {
  runId: string;
  nodeId: string;
  kind: string;
  port: string | null;
  versionId: string;
  at: Date;
  data?: unknown;
}

export interface WorkflowActivity {
  /** Runs a trigger started in the period. */
  started: number;
  /** Runs where they replied (a tap, a typed answer, a reply to J). */
  replied: number;
  /** Runs where an email Ask got a valid email. */
  emails: number;
  /** Runs that reached the end of the workflow (not quiet, stopped or replaced). */
  finished: number;
  /** Runs that picked an option marked qualifies, or booked a call. */
  qualified: number;
  /** Runs where a setter step released a lead magnet. */
  leadMagnets: number;
}

export const WORKFLOW_STEPS: { key: keyof Omit<WorkflowActivity, "leadMagnets">; label: string }[] = [
  { key: "started", label: "Runs started" },
  { key: "replied", label: "Replied" },
  { key: "emails", label: "Emails captured" },
  { key: "finished", label: "Finished" },
  { key: "qualified", label: "Qualified" },
];

export interface WorkflowCell {
  key: string;
  label: string;
  n: number;
  /** % of runs started; null for the first cell or when nothing started. */
  pct: number | null;
}

const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

/** Pure: "<nodeId>:reply:<optionId>" for every quick-reply option marked qualifies. */
export function qualifyingPorts(graph: WorkflowGraph): Set<string> {
  const out = new Set<string>();
  for (const n of graph.nodes) {
    if (n.type !== "message") continue;
    const r = STEP_DATA.message.safeParse(n.data);
    if (!r.success) continue;
    for (const b of r.data.bubbles) if (b.kind === "quick_replies") for (const o of b.options) if (o.qualifies) out.add(`${n.id}:reply:${o.id}`);
  }
  return out;
}

/** Pure: the period's workflow activity. `graphs` maps versionId → that version's graph. */
export function workflowActivity(runs: WfRunLite[], events: WfEventLite[], graphs: Map<string, WorkflowGraph>, since: Date, now: Date): WorkflowActivity {
  const inPeriod = (d: Date | null) => !!d && d >= since && d <= now;
  const evs = events.filter((e) => inPeriod(e.at));
  const runsWith = (pred: (e: WfEventLite) => boolean) => new Set(evs.filter(pred).map((e) => e.runId));
  const qualifying = new Map<string, Set<string>>();
  const portsOf = (versionId: string) => {
    if (!qualifying.has(versionId)) qualifying.set(versionId, graphs.has(versionId) ? qualifyingPorts(graphs.get(versionId)!) : new Set());
    return qualifying.get(versionId)!;
  };
  const qualified = runsWith((e) => (e.kind === "leave" && !!e.port && portsOf(e.versionId).has(`${e.nodeId}:${e.port}`)) || e.kind === "booked");
  return {
    started: runs.filter((r) => inPeriod(r.startedAt)).length,
    replied: runsWith((e) => e.kind === "replied").size,
    emails: runsWith((e) => e.kind === "replied" && obj(e.data).saved === true && obj(e.data).validate === "email").size,
    finished: runs.filter((r) => inPeriod(r.endedAt) && r.status === "COMPLETED" && r.exit === "completed").length,
    qualified: qualified.size,
    leadMagnets: runsWith((e) => e.kind === "released").size,
  };
}

/** Pure: the Workflows row on Home, each step as a % of runs started. */
export function workflowRow(a: WorkflowActivity): WorkflowCell[] {
  return WORKFLOW_STEPS.map((s, i) => ({ key: s.key, label: s.label, n: a[s.key], pct: i === 0 || !a.started ? null : Math.round((a[s.key] / a.started) * 100) }));
}

/**
 * Pure: the outcome row's counts with workflows added. Keyword triggers gain
 * the runs started; Conversations started gain the people who replied in a
 * workflow and weren't already counted (by contact); Lead magnets sent gain
 * the setter-step releases.
 */
export function withWorkflows(
  counts: Partial<Record<OsEventKind, number>>,
  a: WorkflowActivity,
  replied: { counted: Set<string>; repliedContacts: (string | null)[] }
): Partial<Record<OsEventKind, number>> {
  const seen = new Set(replied.counted);
  let extra = 0;
  for (const c of replied.repliedContacts) {
    if (c === null) extra++;
    else if (!seen.has(c)) {
      seen.add(c);
      extra++;
    }
  }
  return {
    ...counts,
    keyword_trigger: (counts.keyword_trigger ?? 0) + a.started,
    conversation_started: (counts.conversation_started ?? 0) + extra,
    lead_magnet_sent: (counts.lead_magnet_sent ?? 0) + a.leadMagnets,
  };
}

// --- Loader ------------------------------------------------------------------

export interface WorkflowPeriod {
  activity: WorkflowActivity;
  /** One per run that replied in the period: its contact (null = not linked yet). */
  repliedContacts: (string | null)[];
  /** The workspace has at least one workflow. */
  any: boolean;
}

export async function loadWorkflowActivity(workspaceId: string, since: Date, now = new Date()): Promise<WorkflowPeriod> {
  const any = (await prisma.workflow.count({ where: { workspaceId } })) > 0;
  const empty: WorkflowActivity = { started: 0, replied: 0, emails: 0, finished: 0, qualified: 0, leadMagnets: 0 };
  if (!any) return { activity: empty, repliedContacts: [], any };
  const events = await prisma.workflowRunEvent.findMany({
    where: { workspaceId, at: { gte: since, lte: now }, kind: { in: ["replied", "leave", "booked", "released"] } },
    select: { runId: true, nodeId: true, kind: true, port: true, versionId: true, at: true, data: true },
    take: 50_000,
  });
  const runs = await prisma.workflowRun.findMany({
    where: { workspaceId, OR: [{ startedAt: { gte: since, lte: now } }, { endedAt: { gte: since, lte: now } }, { id: { in: [...new Set(events.map((e) => e.runId))] } }] },
    select: { id: true, contactId: true, versionId: true, startedAt: true, endedAt: true, status: true, exit: true },
  });
  const versionIds = [...new Set(events.filter((e) => e.kind === "leave").map((e) => e.versionId))];
  const versions = versionIds.length ? await prisma.workflowVersion.findMany({ where: { id: { in: versionIds } }, select: { id: true, graph: true } }) : [];
  const graphs = new Map<string, WorkflowGraph>();
  for (const v of versions) {
    const g = WorkflowGraph.safeParse(v.graph);
    if (g.success) graphs.set(v.id, g.data);
  }
  const activity = workflowActivity(runs, events, graphs, since, now);
  const contactOf = new Map(runs.map((r) => [r.id, r.contactId]));
  const repliedRuns = [...new Set(events.filter((e) => e.kind === "replied").map((e) => e.runId))];
  return { activity, repliedContacts: repliedRuns.map((id) => contactOf.get(id) ?? null), any };
}
