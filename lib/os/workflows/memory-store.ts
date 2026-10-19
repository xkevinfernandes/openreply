// An in-memory WorkflowStore: tests and OS_MOCK. Same rules as the database:
// one live run per person (liveKey), sticky Randomizer branches, idempotent
// inbound keys.

import { isLive, type NewRun, type RunEventRow, type RunRecord, type VersionDef, type WorkflowDef, type WorkflowStore } from "@/lib/os/workflows/types";

export interface MemoryWorkflowStore extends WorkflowStore {
  workflows: Map<string, WorkflowDef>;
  versionsById: Map<string, VersionDef>;
  runs: Map<string, RunRecord>;
  events: RunEventRow[];
  assignments: Map<string, string>;
  inbound: Set<string>;
  addWorkflow(wf: WorkflowDef, version?: VersionDef): void;
}

const clone = <T>(x: T): T => structuredClone(x);

export function memoryWorkflowStore(): MemoryWorkflowStore {
  let seq = 0;
  const workflows = new Map<string, WorkflowDef>();
  const versionsById = new Map<string, VersionDef>();
  const runs = new Map<string, RunRecord>();
  const events: RunEventRow[] = [];
  const assignments = new Map<string, string>();
  const inbound = new Set<string>();
  const liveKeys = new Map<string, string>();
  const key = (a: string, u: string) => `${a}:${u}`;

  return {
    workflows,
    versionsById,
    runs,
    events,
    assignments,
    inbound,
    addWorkflow(wf, version) {
      workflows.set(wf.id, wf);
      if (version) versionsById.set(version.id, version);
    },
    async liveWorkflows(workspaceId, instagramAccountId) {
      const out: { wf: WorkflowDef; version: VersionDef }[] = [];
      for (const wf of workflows.values()) {
        if (wf.workspaceId !== workspaceId || !wf.active || !wf.currentVersionId) continue;
        if (wf.instagramAccountId && wf.instagramAccountId !== instagramAccountId) continue;
        const v = versionsById.get(wf.currentVersionId);
        if (v) out.push({ wf: clone(wf), version: clone(v) });
      }
      return out;
    },
    async workflow(id) {
      const w = workflows.get(id);
      return w ? clone(w) : null;
    },
    async version(id) {
      const v = versionsById.get(id);
      return v ? clone(v) : null;
    },
    async liveRun(a, u) {
      const id = liveKeys.get(key(a, u));
      const r = id ? runs.get(id) : null;
      return r ? clone(r) : null;
    },
    async liveRunForContact(contactId) {
      for (const r of runs.values()) if (r.contactId === contactId && isLive(r.status)) return clone(r);
      return null;
    },
    async runsOf(a, u, opts = {}) {
      return [...runs.values()]
        .filter(
          (r) =>
            r.instagramAccountId === a &&
            r.igUserId === u &&
            (!opts.workflowId || r.workflowId === opts.workflowId) &&
            (!opts.keyword || r.keyword === opts.keyword) &&
            (!opts.since || r.startedAt >= opts.since)
        )
        .sort((x, y) => y.startedAt.getTime() - x.startedAt.getTime())
        .map(clone);
    },
    async createRun(input: NewRun) {
      const k = key(input.instagramAccountId, input.igUserId);
      if (liveKeys.has(k)) return null;
      const run: RunRecord = {
        id: `run${++seq}`,
        ...input,
        status: "active",
        waitUntil: null,
        waitingFor: null,
        setter: { held: [], released: [], asks: 0, lowEffort: 0, replies: 0, notes: [] },
        state: {},
        pausedAt: null,
        pausedReason: null,
        exit: null,
        failReason: null,
        attempts: 0,
        endedAt: null,
      };
      runs.set(run.id, run);
      liveKeys.set(k, run.id);
      return clone(run);
    },
    async saveRun(run) {
      runs.set(run.id, clone(run));
      const k = key(run.instagramAccountId, run.igUserId);
      if (isLive(run.status)) liveKeys.set(k, run.id);
      else if (liveKeys.get(k) === run.id) liveKeys.delete(k);
    },
    async getRun(id) {
      const r = runs.get(id);
      return r ? clone(r) : null;
    },
    async event(e) {
      events.push({ runId: e.run.id, workflowId: e.run.workflowId, versionId: e.run.versionId, nodeId: e.nodeId, kind: e.kind, port: e.port ?? null, data: e.data ?? {}, at: e.at });
    },
    async assignment(k, pickBranch) {
      const id = `${k.workflowId}:${k.nodeId}:${k.instagramAccountId}:${k.igUserId}`;
      if (!assignments.has(id)) assignments.set(id, pickBranch());
      return assignments.get(id)!;
    },
    async claimInbound(k) {
      if (inbound.has(k)) return false;
      inbound.add(k);
      return true;
    },
    async dueRuns(now, limit = 100) {
      return [...runs.values()]
        .filter((r) => (r.status === "waiting" || r.status === "active") && r.waitUntil && r.waitUntil <= now)
        .slice(0, limit)
        .map(clone);
    },
  };
}
