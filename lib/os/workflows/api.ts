// The workflows server API for the builder (components/os/workflows/*,
// app/(os)/os/automations/workflows/*). Plain server functions that take the
// workspace id: the canvas wraps them in its own server actions. Nothing here
// sends a message. Engine: lib/os/workflows/engine.ts. Spec:
// docs/sp/dms/2026-10-19-workflows-spec.md.

import type { GraphProblem, StepType, WorkflowGraph } from "@/lib/os/workflows/graph";

export type WorkflowMode = "draft" | "auto";
export type TemplateId = "hold_lead_magnet" | "send_link" | "start_conversation" | "blank";
export type RunStatus = "active" | "waiting" | "paused" | "completed" | "exited" | "replaced" | "failed";
export type StatsPeriod = "7d" | "30d" | "all";

export interface TemplateInfo {
  id: TemplateId;
  name: string;
  description: string;
}

/** A builder warning: doesn't block Publish (e.g. a wait past Instagram's 24h). */
export interface GraphWarning {
  nodeId?: string;
  message: string;
}

export interface WorkflowTriggerSummary {
  kind: "comment" | "story_reply" | "dm";
  keywords: string[];
  postIds: string[] | "any";
}

export interface WorkflowSummary {
  id: string;
  name: string;
  mode: WorkflowMode;
  /** On = new people can enter. */
  active: boolean;
  /** From the published version (else the draft). */
  trigger: WorkflowTriggerSummary | null;
  /** Published version number; null = never published. */
  version: number | null;
  /** The draft differs from the published version. */
  unpublished: boolean;
  runs: { active: number; paused: number; failed: number; total: number };
  updatedAt: string;
}

export interface WorkflowVersionInfo {
  id: string;
  number: number;
  publishedAt: string;
  /** People still running on this version. */
  activeRuns: number;
}

export interface WorkflowDetail extends WorkflowSummary {
  /** What the canvas edits. */
  draft: WorkflowGraph;
  published: WorkflowGraph | null;
  versions: WorkflowVersionInfo[];
  /** validateGraph on the draft: these block Publish. */
  problems: GraphProblem[];
  warnings: GraphWarning[];
}

export type ApiResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface PublishOptions {
  /** A step removed from the graph while people wait on it: where they go
   *  (node id in the new graph), by removed node id. */
  moves?: Record<string, string>;
}

export type PublishResult =
  | { ok: true; version: number; versionId: string; moved: number }
  | {
      ok: false;
      error: string;
      problems: GraphProblem[];
      /** Removed steps that still have people on them: pass `moves` for each. */
      waiting?: { nodeId: string; count: number }[];
      /** Keyword clashes (another workflow, a live OpenReply campaign, Zernio). */
      clashes?: KeywordClash[];
    };

export interface KeywordClash {
  keyword: string;
  with: "workflow" | "campaign" | "zernio";
  id: string;
  name: string;
}

export interface SetterNodeStats {
  reached: number;
  replied: number;
  released: number;
  booked: number;
  showed: number;
}

export interface NodeStats {
  nodeId: string;
  type: StepType;
  /** People who reached it in the period. */
  reached: number;
  /** % of the step before it (null for the trigger / no predecessor). */
  pctOfPrev: number | null;
  setter?: SetterNodeStats;
}

export interface WorkflowStats {
  period: StatsPeriod;
  versionId: string | null;
  header: { triggered: number; replied: number; leadMagnet: number; booked: number; showed: number };
  nodes: Record<string, NodeStats>;
  /** People who left by an arrow, keyed "<nodeId>:<port>" (setter exits on the arrows). */
  ports: Record<string, number>;
}

/** The run a contact is in, for the thread strip ("Paused · you replied" + Resume). */
export interface ContactRunView {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: RunStatus;
  nodeId: string | null;
  nodeType: StepType | null;
  pausedAt: string | null;
  pausedReason: string | null;
  failReason: string | null;
  /** Setter step: what J is holding and what went out. */
  held: string[];
  released: string[];
  waitUntil: string | null;
}

// ---------------------------------------------------------------- implementation
// Real bodies live in api-impl.ts (DB access), loaded lazily so this file stays
// importable from client-side type imports.

const impl = () => import("@/lib/os/workflows/api-impl");

export async function listTemplates(): Promise<TemplateInfo[]> {
  return (await impl()).listTemplates();
}

export async function listWorkflows(workspaceId: string): Promise<WorkflowSummary[]> {
  return (await impl()).listWorkflows(workspaceId);
}

export async function getWorkflow(workspaceId: string, id: string): Promise<WorkflowDetail | null> {
  return (await impl()).getWorkflow(workspaceId, id);
}

export async function createWorkflow(
  workspaceId: string,
  input: { templateId: TemplateId; name?: string; instagramAccountId?: string | null }
): Promise<ApiResult<{ id: string }>> {
  return (await impl()).createWorkflow(workspaceId, input);
}

/** Save the canvas (no validation beyond the shape; Publish validates). */
export async function saveDraft(workspaceId: string, id: string, graph: WorkflowGraph, opts: { name?: string } = {}): Promise<ApiResult<{ warnings: GraphWarning[] }>> {
  return (await impl()).saveDraft(workspaceId, id, graph, opts);
}

/** Validate (graph + keyword uniqueness) and make a new version. */
export async function publishWorkflow(workspaceId: string, id: string, opts: PublishOptions = {}): Promise<PublishResult> {
  return (await impl()).publishWorkflow(workspaceId, id, opts);
}

/** Draft = J's words wait for Approve; Auto = autopilot (delay, cap, Pause all). Kevin's own Message steps always send. */
export async function setWorkflowMode(workspaceId: string, id: string, mode: WorkflowMode): Promise<ApiResult> {
  return (await impl()).setWorkflowMode(workspaceId, id, mode);
}

/** Off = no new runs; active ones finish at their next Setter exit. Needs a published version to turn on. */
export async function setWorkflowActive(workspaceId: string, id: string, active: boolean): Promise<ApiResult> {
  return (await impl()).setWorkflowActive(workspaceId, id, active);
}

/** "Stop everyone now" (confirmed in the UI): every live run ends at once. */
export async function stopEveryone(workspaceId: string, id: string): Promise<ApiResult<{ stopped: number }>> {
  return (await impl()).stopEveryone(workspaceId, id);
}

export async function workflowStats(workspaceId: string, id: string, opts: { period?: StatsPeriod; versionId?: string | null } = {}): Promise<WorkflowStats | null> {
  return (await impl()).workflowStats(workspaceId, id, opts);
}

/** Kevin took over: the run and J pause for this contact; every timer stops. */
export async function pauseContact(workspaceId: string, contactId: string, reason = "you replied"): Promise<ApiResult<{ runId: string | null }>> {
  return (await impl()).pauseContact(workspaceId, contactId, reason);
}

/** Continue from the same step; timers restart from now. */
export async function resumeContact(workspaceId: string, contactId: string): Promise<ApiResult<{ runId: string | null }>> {
  return (await impl()).resumeContact(workspaceId, contactId);
}

export async function contactRun(workspaceId: string, contactId: string): Promise<ContactRunView | null> {
  return (await impl()).contactRun(workspaceId, contactId);
}
