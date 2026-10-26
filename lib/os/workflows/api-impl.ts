// The workflows API's bodies (lib/os/workflows/api.ts has the types and the
// doc comments). Postgres; nothing here sends a message except the engine
// moving people off a deleted step after Publish.

import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import type * as A from "@/lib/os/workflows/api";
import { fromDbStatus, runFromRow, versionFromRow, wfFromRow } from "@/lib/os/workflows/db-store";
import { validateGraph, WorkflowGraph, type GraphProblem } from "@/lib/os/workflows/graph";
import { computeStats } from "@/lib/os/workflows/stats";
import { templateGraph, TEMPLATES } from "@/lib/os/workflows/templates";
import { graphKeywords, keywordClashes, triggerNode, zernioKeywordsOf, type CampaignKeywords, type OtherWorkflow } from "@/lib/os/workflows/triggers";
import { graphWarnings } from "@/lib/os/workflows/warnings";

const LIVE = ["ACTIVE", "WAITING", "PAUSED"] as const;
const json = (v: unknown) => v as Prisma.InputJsonValue;
const err = (error: string) => ({ ok: false as const, error });

function parseGraph(v: unknown): WorkflowGraph {
  const r = WorkflowGraph.safeParse(v);
  return r.success ? r.data : { version: 1, nodes: [], edges: [] };
}

function triggerSummary(g: WorkflowGraph): A.WorkflowTriggerSummary | null {
  const t = triggerNode(g);
  return t ? { kind: t.data.kind, keywords: t.data.keywords, postIds: t.data.postIds } : null;
}

// ---------------------------------------------------------------- pure helpers
/** Live runs standing on steps the new graph no longer has. */
export function waitingOnRemoved(runs: { currentNodeId: string | null }[], graph: WorkflowGraph): { nodeId: string; count: number }[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  const out = new Map<string, number>();
  for (const r of runs) if (r.currentNodeId && !ids.has(r.currentNodeId)) out.set(r.currentNodeId, (out.get(r.currentNodeId) ?? 0) + 1);
  return [...out].map(([nodeId, count]) => ({ nodeId, count }));
}

/** Publish blockers besides the graph: a removed step with people and no target. */
export function moveProblems(waiting: { nodeId: string; count: number }[], moves: Record<string, string>, graph: WorkflowGraph): GraphProblem[] {
  const ids = new Set(graph.nodes.map((n) => n.id));
  return waiting
    .filter((w) => !moves[w.nodeId] || !ids.has(moves[w.nodeId]) || graph.nodes.find((n) => n.id === moves[w.nodeId])?.type === "trigger")
    .map((w) => ({ nodeId: w.nodeId, message: `${w.count} ${w.count === 1 ? "person is" : "people are"} waiting on a step you removed: choose where they go` }));
}

// ---------------------------------------------------------------- reads
async function counts(workflowIds: string[]) {
  const rows = workflowIds.length ? await prisma.workflowRun.groupBy({ by: ["workflowId", "status"], where: { workflowId: { in: workflowIds } }, _count: { _all: true } }) : [];
  const out = new Map<string, A.WorkflowSummary["runs"]>();
  for (const id of workflowIds) out.set(id, { active: 0, paused: 0, failed: 0, total: 0 });
  for (const r of rows) {
    const c = out.get(r.workflowId)!;
    const n = r._count._all;
    c.total += n;
    if (r.status === "ACTIVE" || r.status === "WAITING") c.active += n;
    if (r.status === "PAUSED") c.paused += n;
    if (r.status === "FAILED") c.failed += n;
  }
  return out;
}

type WfRow = Prisma.WorkflowGetPayload<object>;

async function summaries(rows: WfRow[]): Promise<{ summary: A.WorkflowSummary; published: WorkflowGraph | null; versionNumber: number | null }[]> {
  const versions = await prisma.workflowVersion.findMany({ where: { id: { in: rows.map((r) => r.currentVersionId).filter((x): x is string => Boolean(x)) } } });
  const byId = new Map(versions.map((v) => [v.id, v]));
  const runCounts = await counts(rows.map((r) => r.id));
  return rows.map((w) => {
    const v = w.currentVersionId ? byId.get(w.currentVersionId) : null;
    const published = v ? parseGraph(v.graph) : null;
    const draft = parseGraph(w.draftGraph);
    return {
      summary: {
        id: w.id,
        name: w.name,
        mode: w.mode === "auto" ? "auto" : "draft",
        active: w.active,
        trigger: triggerSummary(published ?? draft),
        version: v?.number ?? null,
        unpublished: !published || JSON.stringify(published) !== JSON.stringify(draft),
        runs: runCounts.get(w.id)!,
        updatedAt: w.updatedAt.toISOString(),
      },
      published,
      versionNumber: v?.number ?? null,
    };
  });
}

export async function listTemplates(): Promise<A.TemplateInfo[]> {
  return TEMPLATES;
}

export async function listWorkflows(workspaceId: string): Promise<A.WorkflowSummary[]> {
  const rows = await prisma.workflow.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
  return (await summaries(rows)).map((x) => x.summary);
}

export async function getWorkflow(workspaceId: string, id: string): Promise<A.WorkflowDetail | null> {
  const w = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!w) return null;
  const [{ summary, published }] = await summaries([w]);
  const draft = parseGraph(w.draftGraph);
  const versions = await prisma.workflowVersion.findMany({ where: { workflowId: id }, orderBy: { number: "desc" }, select: { id: true, number: true, publishedAt: true } });
  const live = await prisma.workflowRun.groupBy({ by: ["versionId"], where: { workflowId: id, status: { in: [...LIVE] } }, _count: { _all: true } });
  const liveBy = new Map(live.map((l) => [l.versionId, l._count._all]));
  return {
    ...summary,
    draft,
    published,
    versions: versions.map((v) => ({ id: v.id, number: v.number, publishedAt: v.publishedAt.toISOString(), activeRuns: liveBy.get(v.id) ?? 0 })),
    problems: validateGraph(w.draftGraph),
    warnings: graphWarnings(draft),
  };
}

// ---------------------------------------------------------------- writes
export async function createWorkflow(workspaceId: string, input: { templateId: A.TemplateId; name?: string; instagramAccountId?: string | null }): Promise<A.ApiResult<{ id: string }>> {
  const t = TEMPLATES.find((x) => x.id === input.templateId);
  if (!t) return err("Unknown template.");
  const name = (input.name ?? "").trim() || t.name;
  const w = await prisma.workflow.create({
    data: { workspaceId, name: name.slice(0, 120), instagramAccountId: input.instagramAccountId ?? null, draftGraph: json(templateGraph(t.id)) },
  });
  return { ok: true, id: w.id };
}

export async function saveDraft(workspaceId: string, id: string, graph: WorkflowGraph, opts: { name?: string }): Promise<A.ApiResult<{ warnings: A.GraphWarning[] }>> {
  const parsed = WorkflowGraph.safeParse(graph);
  if (!parsed.success) return err(parsed.error.issues[0]?.message ?? "That workflow can't be saved.");
  const name = opts.name?.trim();
  const r = await prisma.workflow.updateMany({ where: { id, workspaceId }, data: { draftGraph: json(parsed.data), ...(name ? { name: name.slice(0, 120) } : {}) } });
  if (!r.count) return err("That workflow is gone. Refresh.");
  return { ok: true, warnings: graphWarnings(parsed.data) };
}

/** Keyword clashes of a graph with other live workflows, live OpenReply campaigns and Zernio keywords. */
export async function clashesFor(workspaceId: string, workflowId: string, graph: WorkflowGraph): Promise<A.KeywordClash[]> {
  const t = triggerNode(graph);
  if (!t) return [];
  const others = await prisma.workflow.findMany({ where: { workspaceId, active: true, id: { not: workflowId }, currentVersionId: { not: null } } });
  const versions = await prisma.workflowVersion.findMany({ where: { id: { in: others.map((o) => o.currentVersionId!) } } });
  const vBy = new Map(versions.map((v) => [v.id, versionFromRow(v)]));
  const otherGraphs: OtherWorkflow[] = others.flatMap((o) => (vBy.has(o.currentVersionId!) ? [{ id: o.id, name: o.name, graph: vBy.get(o.currentVersionId!)!.graph }] : []));
  const campaigns: CampaignKeywords[] = await prisma.automation.findMany({
    where: { workspaceId, isActive: true },
    select: { id: true, name: true, keywords: true, postId: true, matchAnyPost: true, dmTriggerEnabled: true },
  });
  const resources = await prisma.resource.findMany({ where: { workspaceId }, select: { slug: true, name: true, keyword: true, status: true, data: true } });
  return keywordClashes(graph, otherGraphs, campaigns, zernioKeywordsOf(resources));
}

export async function publishWorkflow(workspaceId: string, id: string, opts: A.PublishOptions): Promise<A.PublishResult> {
  const w = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!w) return { ok: false, error: "That workflow is gone. Refresh.", problems: [] };
  const graph = parseGraph(w.draftGraph);
  const problems = validateGraph(w.draftGraph);
  if (problems.length) return { ok: false, error: "Fix the marked steps first.", problems };
  const clashes = await clashesFor(workspaceId, id, graph);
  if (clashes.length) {
    const c = clashes[0];
    const where = c.with === "workflow" ? `the workflow "${c.name}"` : c.with === "campaign" ? `the campaign "${c.name}"` : `Zernio (${c.name})`;
    return { ok: false, error: `"${c.keyword}" already lives in ${where}. One keyword, one place.`, problems: [], clashes };
  }
  const liveRuns = await prisma.workflowRun.findMany({ where: { workflowId: id, status: { in: [...LIVE] } } });
  const moves = opts.moves ?? {};
  const waiting = waitingOnRemoved(liveRuns, graph);
  const moveIssues = moveProblems(waiting, moves, graph);
  if (moveIssues.length) return { ok: false, error: moveIssues[0].message, problems: moveIssues, waiting };

  const last = await prisma.workflowVersion.findFirst({ where: { workflowId: id }, orderBy: { number: "desc" }, select: { number: true } });
  const number = (last?.number ?? 0) + 1;
  const v = await prisma.$transaction(async (tx) => {
    const v = await tx.workflowVersion.create({ data: { workflowId: id, number, graph: json(graph), keywords: graphKeywords(graph) } });
    await tx.workflow.update({ where: { id }, data: { currentVersionId: v.id } });
    return v;
  });

  // People on a removed step go where Kevin chose, on the new version.
  let moved = 0;
  const removed = new Set(waiting.map((x) => x.nodeId));
  const toMove = liveRuns.filter((r) => r.currentNodeId && removed.has(r.currentNodeId));
  if (toMove.length) {
    const { workflowEngine } = await import("@/lib/os/workflows/hooks");
    const engine = workflowEngine();
    for (const r of toMove) {
      const run = runFromRow(r);
      run.versionId = v.id;
      run.currentNodeId = moves[r.currentNodeId!];
      run.state = { ...run.state, entered: null };
      run.waitUntil = new Date();
      await prisma.workflowRun.update({ where: { id: r.id }, data: { versionId: v.id, currentNodeId: run.currentNodeId, state: json(run.state), waitUntil: run.waitUntil } });
      if (run.status !== "paused") await engine.tick(run.id).catch((e) => console.error("[OS Workflows] move:", e instanceof Error ? e.message : e));
      moved++;
    }
  }
  return { ok: true, version: number, versionId: v.id, moved };
}

export async function setWorkflowMode(workspaceId: string, id: string, mode: A.WorkflowMode): Promise<A.ApiResult> {
  if (mode !== "draft" && mode !== "auto") return err("Approve each DM or Auto-send.");
  const r = await prisma.workflow.updateMany({ where: { id, workspaceId }, data: { mode } });
  return r.count ? { ok: true } : err("That workflow is gone. Refresh.");
}

export async function setWorkflowActive(workspaceId: string, id: string, active: boolean): Promise<A.ApiResult> {
  const w = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!w) return err("That workflow is gone. Refresh.");
  if (active) {
    if (!w.currentVersionId) return err("Publish it first.");
    const v = await prisma.workflowVersion.findUnique({ where: { id: w.currentVersionId } });
    const clashes = v ? await clashesFor(workspaceId, id, versionFromRow(v).graph) : [];
    if (clashes.length) return err(`"${clashes[0].keyword}" already lives in ${clashes[0].with === "workflow" ? `"${clashes[0].name}"` : clashes[0].with === "campaign" ? `the campaign "${clashes[0].name}"` : "Zernio"}.`);
  }
  await prisma.workflow.update({ where: { id }, data: { active } });
  return { ok: true };
}

export async function stopEveryone(workspaceId: string, id: string): Promise<A.ApiResult<{ stopped: number }>> {
  const w = await prisma.workflow.findFirst({ where: { id, workspaceId }, select: { id: true } });
  if (!w) return err("That workflow is gone. Refresh.");
  const rows = await prisma.workflowRun.findMany({ where: { workflowId: id, status: { in: [...LIVE] } } });
  const { workflowEngine } = await import("@/lib/os/workflows/hooks");
  const stopped = await workflowEngine().stopAll(id, rows.map(runFromRow));
  return { ok: true, stopped };
}

export async function workflowStats(workspaceId: string, id: string, opts: { period?: A.StatsPeriod; versionId?: string | null }): Promise<A.WorkflowStats | null> {
  const w = await prisma.workflow.findFirst({ where: { id, workspaceId } });
  if (!w) return null;
  const vId = opts.versionId ?? w.currentVersionId;
  const v = vId ? await prisma.workflowVersion.findUnique({ where: { id: vId } }) : null;
  const graph = v ? versionFromRow(v).graph : parseGraph(w.draftGraph);
  const period = opts.period ?? "30d";
  const now = new Date();
  const since = period === "all" ? undefined : new Date(now.getTime() - (period === "7d" ? 7 : 30) * 86_400_000);
  const events = await prisma.workflowRunEvent.findMany({
    where: { workflowId: id, ...(since ? { at: { gte: since } } : {}), ...(opts.versionId ? { versionId: opts.versionId } : {}) },
    select: { runId: true, nodeId: true, kind: true, port: true, at: true, versionId: true, data: true },
  });
  const bookedRuns = [...new Set(events.filter((e) => e.kind === "booked").map((e) => e.runId))];
  const runs = bookedRuns.length ? await prisma.workflowRun.findMany({ where: { id: { in: bookedRuns } }, select: { id: true, contactId: true, startedAt: true } }) : [];
  const showedRuns = new Set<string>();
  for (const r of runs) {
    if (!r.contactId) continue;
    const b = await prisma.booking.count({ where: { contactId: r.contactId, attendance: "SHOWED", createdAt: { gte: r.startedAt } } });
    if (b) showedRuns.add(r.id);
  }
  // By reel: the post each comment run came from (run.trigger), and its link when a campaign knows the post.
  const runIds = [...new Set(events.map((e) => e.runId))];
  const runRows = runIds.length ? await prisma.workflowRun.findMany({ where: { id: { in: runIds } }, select: { id: true, trigger: true } }) : [];
  const runPosts = new Map<string, string>();
  for (const r of runRows) {
    const t = (r.trigger && typeof r.trigger === "object" ? r.trigger : {}) as { kind?: string; postId?: string | null };
    if (t.kind === "comment" && t.postId) runPosts.set(r.id, t.postId);
  }
  const stats = computeStats(graph, events, { period, now, versionId: opts.versionId ?? null, showedRuns, runPosts });
  if (stats.byReel.length) {
    const posts = await prisma.automation.findMany({ where: { workspaceId, postId: { in: stats.byReel.map((r) => r.postId) }, postUrl: { not: null } }, select: { postId: true, postUrl: true } });
    const url = new Map(posts.map((p) => [p.postId!, p.postUrl!]));
    for (const r of stats.byReel) r.permalink = url.get(r.postId) ?? null;
  }
  return stats;
}

export async function pauseContact(workspaceId: string, contactId: string, reason: string): Promise<A.ApiResult<{ runId: string | null }>> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true } });
  if (!c) return err("Contact not found.");
  const row = await prisma.workflowRun.findFirst({ where: { contactId, status: { in: ["ACTIVE", "WAITING"] } } });
  if (!row) {
    await prisma.contact.update({ where: { id: contactId }, data: { paused: true } });
    return { ok: true, runId: null };
  }
  const { workflowEngine } = await import("@/lib/os/workflows/hooks");
  await workflowEngine().pauseRun(runFromRow(row), reason);
  return { ok: true, runId: row.id };
}

export async function resumeContact(workspaceId: string, contactId: string): Promise<A.ApiResult<{ runId: string | null }>> {
  const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true } });
  if (!c) return err("Contact not found.");
  const row = await prisma.workflowRun.findFirst({ where: { contactId, status: "PAUSED" } });
  if (!row) {
    await prisma.contact.update({ where: { id: contactId }, data: { paused: false } });
    return { ok: true, runId: null };
  }
  const { workflowEngine } = await import("@/lib/os/workflows/hooks");
  await workflowEngine().resumeRun(runFromRow(row));
  return { ok: true, runId: row.id };
}

export async function contactRun(workspaceId: string, contactId: string): Promise<A.ContactRunView | null> {
  const row =
    (await prisma.workflowRun.findFirst({ where: { workspaceId, contactId, status: { in: [...LIVE] } }, orderBy: { startedAt: "desc" } })) ??
    (await prisma.workflowRun.findFirst({ where: { workspaceId, contactId }, orderBy: { startedAt: "desc" } }));
  if (!row) return null;
  const run = runFromRow(row);
  const [w, v] = await Promise.all([prisma.workflow.findUnique({ where: { id: row.workflowId } }), prisma.workflowVersion.findUnique({ where: { id: row.versionId } })]);
  const node = v ? versionFromRow(v).graph.nodes.find((n) => n.id === row.currentNodeId) : null;
  return {
    runId: row.id,
    workflowId: row.workflowId,
    workflowName: w ? wfFromRow(w).name : "",
    status: fromDbStatus(row.status),
    nodeId: row.currentNodeId,
    nodeType: node?.type ?? null,
    pausedAt: row.pausedAt?.toISOString() ?? null,
    pausedReason: row.pausedReason,
    failReason: row.failReason,
    held: run.setter.held.filter((h) => !run.setter.released.includes(h)),
    released: run.setter.released,
    waitUntil: row.waitUntil?.toISOString() ?? null,
  };
}
