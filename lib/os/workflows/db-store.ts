// The Postgres WorkflowStore (prisma/os-workflows.prisma).
import { randomUUID } from "node:crypto";
import { Prisma, type WorkflowRunStatus } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { recordEventQuietly } from "@/lib/os/events";
import { WorkflowGraph } from "@/lib/os/workflows/graph";
import { isLive, type RunRecord, type RunStatus, type SetterRunState, type TriggerInfo, type VersionDef, type WorkflowDef, type WorkflowStore } from "@/lib/os/workflows/types";

export const toDbStatus = (s: RunStatus) => s.toUpperCase() as WorkflowRunStatus;
export const fromDbStatus = (s: WorkflowRunStatus) => s.toLowerCase() as RunStatus;
const LIVE_DB: WorkflowRunStatus[] = ["ACTIVE", "WAITING", "PAUSED"];

type RunRow = Prisma.WorkflowRunGetPayload<object>;
type WfRow = Prisma.WorkflowGetPayload<object>;
type VersionRow = Prisma.WorkflowVersionGetPayload<object>;

const obj = <T>(v: unknown, fallback: T): T => (v && typeof v === "object" && !Array.isArray(v) ? (v as T) : fallback);

export function runFromRow(r: RunRow): RunRecord {
  const setter = obj<Partial<SetterRunState>>(r.setterState, {});
  return {
    id: r.id,
    workspaceId: r.workspaceId,
    workflowId: r.workflowId,
    versionId: r.versionId,
    instagramAccountId: r.instagramAccountId,
    igUserId: r.igUserId,
    contactId: r.contactId,
    status: fromDbStatus(r.status),
    currentNodeId: r.currentNodeId,
    waitUntil: r.waitUntil,
    waitingFor: r.waitingFor,
    keyword: r.keyword,
    trigger: obj<TriggerInfo>(r.trigger, { kind: "dm" }),
    setter: { held: [], released: [], asks: 0, lowEffort: 0, replies: 0, notes: [], ...setter },
    state: obj(r.state, {}),
    pausedAt: r.pausedAt,
    pausedReason: r.pausedReason,
    exit: r.exit,
    failReason: r.failReason,
    attempts: r.attempts,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
  };
}

export function wfFromRow(w: WfRow): WorkflowDef {
  return { id: w.id, workspaceId: w.workspaceId, instagramAccountId: w.instagramAccountId, name: w.name, mode: w.mode === "auto" ? "auto" : "draft", active: w.active, currentVersionId: w.currentVersionId };
}

export function versionFromRow(v: VersionRow): VersionDef {
  const g = WorkflowGraph.safeParse(v.graph);
  return { id: v.id, workflowId: v.workflowId, number: v.number, graph: g.success ? g.data : { version: 1, nodes: [], edges: [] }, keywords: v.keywords };
}

const liveKey = (a: string, u: string) => `${a}:${u}`;
const json = (v: unknown) => v as Prisma.InputJsonValue;

export const dbWorkflowStore: WorkflowStore = {
  async liveWorkflows(workspaceId, instagramAccountId) {
    const rows = await prisma.workflow.findMany({
      where: { workspaceId, active: true, currentVersionId: { not: null }, OR: [{ instagramAccountId: null }, { instagramAccountId }] },
      orderBy: { createdAt: "asc" },
    });
    if (!rows.length) return [];
    const versions = await prisma.workflowVersion.findMany({ where: { id: { in: rows.map((r) => r.currentVersionId!) } } });
    const byId = new Map(versions.map((v) => [v.id, versionFromRow(v)]));
    return rows.flatMap((w) => (byId.has(w.currentVersionId!) ? [{ wf: wfFromRow(w), version: byId.get(w.currentVersionId!)! }] : []));
  },
  async workflow(id) {
    const w = await prisma.workflow.findUnique({ where: { id } });
    return w ? wfFromRow(w) : null;
  },
  async version(id) {
    const v = await prisma.workflowVersion.findUnique({ where: { id } });
    return v ? versionFromRow(v) : null;
  },
  async liveRun(a, u) {
    const r = await prisma.workflowRun.findUnique({ where: { liveKey: liveKey(a, u) } });
    return r ? runFromRow(r) : null;
  },
  async liveRunForContact(contactId) {
    const r = await prisma.workflowRun.findFirst({ where: { contactId, status: { in: LIVE_DB } }, orderBy: { startedAt: "desc" } });
    return r ? runFromRow(r) : null;
  },
  async runsOf(a, u, opts = {}) {
    const rows = await prisma.workflowRun.findMany({
      where: {
        instagramAccountId: a,
        igUserId: u,
        ...(opts.workflowId ? { workflowId: opts.workflowId } : {}),
        ...(opts.keyword ? { keyword: opts.keyword } : {}),
        ...(opts.since ? { startedAt: { gte: opts.since } } : {}),
      },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return rows.map(runFromRow);
  },
  async createRun(input) {
    try {
      const r = await prisma.workflowRun.create({
        data: {
          workspaceId: input.workspaceId,
          workflowId: input.workflowId,
          versionId: input.versionId,
          instagramAccountId: input.instagramAccountId,
          igUserId: input.igUserId,
          contactId: input.contactId,
          keyword: input.keyword,
          trigger: json(input.trigger),
          currentNodeId: input.currentNodeId,
          startedAt: input.startedAt,
          status: "ACTIVE",
          liveKey: liveKey(input.instagramAccountId, input.igUserId),
        },
      });
      return runFromRow(r);
    } catch (err) {
      // The unique liveKey: they already have a live run (a webhook racing another).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return null;
      throw err;
    }
  },
  async saveRun(run) {
    await prisma.workflowRun.update({
      where: { id: run.id },
      data: {
        status: toDbStatus(run.status),
        igUserId: run.igUserId,
        currentNodeId: run.currentNodeId,
        waitUntil: run.waitUntil,
        waitingFor: run.waitingFor,
        contactId: run.contactId,
        setterState: json(run.setter),
        state: json(run.state),
        pausedAt: run.pausedAt,
        pausedReason: run.pausedReason,
        exit: run.exit,
        failReason: run.failReason,
        attempts: run.attempts,
        endedAt: run.endedAt,
        liveKey: isLive(run.status) ? liveKey(run.instagramAccountId, run.igUserId) : null,
      },
    });
  },
  async getRun(id) {
    const r = await prisma.workflowRun.findUnique({ where: { id } });
    return r ? runFromRow(r) : null;
  },
  async event(e) {
    await prisma.workflowRunEvent.create({
      data: { workspaceId: e.run.workspaceId, workflowId: e.run.workflowId, versionId: e.run.versionId, runId: e.run.id, nodeId: e.nodeId, kind: e.kind, port: e.port ?? null, data: json(e.data ?? {}), at: e.at },
    });
  },
  async assignment(k, pickBranch) {
    const where = { workflowId_nodeId_instagramAccountId_igUserId: { workflowId: k.workflowId, nodeId: k.nodeId, instagramAccountId: k.instagramAccountId, igUserId: k.igUserId } };
    const found = await prisma.workflowRandomizerAssignment.findUnique({ where });
    if (found) return found.branchId;
    await prisma.workflowRandomizerAssignment.createMany({ data: [{ ...k, branchId: pickBranch() }], skipDuplicates: true });
    return (await prisma.workflowRandomizerAssignment.findUnique({ where }))!.branchId;
  },
  async claimInbound(key, workspaceId) {
    const r = await prisma.workflowInbound.createMany({ data: [{ key, workspaceId }], skipDuplicates: true });
    return r.count === 1;
  },
  async dueRuns(now, limit = 100) {
    const rows = await prisma.workflowRun.findMany({ where: { status: { in: ["ACTIVE", "WAITING"] }, waitUntil: { lte: now } }, orderBy: { waitUntil: "asc" }, take: limit });
    return rows.map(runFromRow);
  },
  async liveRunsOf(workflowId) {
    const rows = await prisma.workflowRun.findMany({ where: { workflowId, status: { in: LIVE_DB } } });
    return rows.map(runFromRow);
  },
  async deleteWorkflow(workflowId) {
    // Versions, runs and run events go with the workflow (onDelete: Cascade);
    // Randomizer branches have no relation, so they go by hand. Inbound and
    // outbound rows are keyed by message / person, not by workflow.
    await prisma.$transaction([prisma.workflowRandomizerAssignment.deleteMany({ where: { workflowId } }), prisma.workflow.deleteMany({ where: { id: workflowId } })]);
  },
  async lockRun(runId, ttlMs) {
    const now = new Date();
    const token = randomUUID();
    const r = await prisma.workflowRun.updateMany({
      where: { id: runId, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockToken: token, lockedUntil: new Date(now.getTime() + ttlMs) },
    });
    return r.count === 1 ? token : null;
  },
  async unlockRun(runId, token) {
    await prisma.workflowRun.updateMany({ where: { id: runId, lockToken: token }, data: { lockToken: null, lockedUntil: null } });
  },
  async skipped(e) {
    // OsEvent, not WorkflowRunEvent: a skip has no run, and the comment id is its dedupeKey (a retried webhook logs it once).
    await recordEventQuietly({
      workspaceId: e.workspaceId,
      kind: "workflow_skipped",
      dedupeKey: `workflow_skipped:${e.commentId}`,
      contactId: e.contactId,
      at: e.at,
      data: { workflowId: e.workflowId, postId: e.postId, originalPostId: e.originalPostId, reason: e.reason },
    });
  },
};
