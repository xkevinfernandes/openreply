// Stub bodies for the workflows API (filled in by stream C1).
import type * as A from "@/lib/os/workflows/api";
import type { WorkflowGraph } from "@/lib/os/workflows/graph";

const todo = <T>(): T => {
  throw new Error("Workflows engine not built yet.");
};

export async function listTemplates(): Promise<A.TemplateInfo[]> {
  return todo();
}
export async function listWorkflows(_w: string): Promise<A.WorkflowSummary[]> {
  return todo();
}
export async function getWorkflow(_w: string, _id: string): Promise<A.WorkflowDetail | null> {
  return todo();
}
export async function createWorkflow(_w: string, _i: { templateId: A.TemplateId; name?: string; instagramAccountId?: string | null }): Promise<A.ApiResult<{ id: string }>> {
  return todo();
}
export async function saveDraft(_w: string, _id: string, _g: WorkflowGraph, _o: { name?: string }): Promise<A.ApiResult<{ warnings: A.GraphWarning[] }>> {
  return todo();
}
export async function publishWorkflow(_w: string, _id: string, _o: A.PublishOptions): Promise<A.PublishResult> {
  return todo();
}
export async function setWorkflowMode(_w: string, _id: string, _m: A.WorkflowMode): Promise<A.ApiResult> {
  return todo();
}
export async function setWorkflowActive(_w: string, _id: string, _a: boolean): Promise<A.ApiResult> {
  return todo();
}
export async function stopEveryone(_w: string, _id: string): Promise<A.ApiResult<{ stopped: number }>> {
  return todo();
}
export async function workflowStats(_w: string, _id: string, _o: { period?: A.StatsPeriod; versionId?: string | null }): Promise<A.WorkflowStats | null> {
  return todo();
}
export async function pauseContact(_w: string, _c: string, _r: string): Promise<A.ApiResult<{ runId: string | null }>> {
  return todo();
}
export async function resumeContact(_w: string, _c: string): Promise<A.ApiResult<{ runId: string | null }>> {
  return todo();
}
export async function contactRun(_w: string, _c: string): Promise<A.ContactRunView | null> {
  return todo();
}
