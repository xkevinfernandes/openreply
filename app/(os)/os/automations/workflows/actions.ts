"use server";

// Automations › Workflows: the builder's writes and the Inbox run line.
// Everything goes through components/os/workflows/data.ts (the adapter onto
// the engine API).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as data from "@/components/os/workflows/data";
import { isTemplateKey } from "@/components/os/workflows/templates";
import type { ContactRun, WorkflowMode } from "@/components/os/workflows/types";
import { getCurrentWorkspaceId } from "@/lib/auth";
import type { GraphProblem, WorkflowGraph } from "@/lib/os/workflows/graph";

type Result<T = object> = ({ error?: undefined } & T) | { error: string };

async function ws(): Promise<string> {
  const id = await getCurrentWorkspaceId();
  if (!id) throw new Error("Sign in again.");
  return id;
}

async function guard<T extends object>(fn: (workspaceId: string) => Promise<T>): Promise<Result<T>> {
  try {
    return await fn(await ws());
  } catch (err) {
    if (!(err instanceof data.WorkflowsUnavailable)) console.error("[OS Workflows]", err);
    return { error: err instanceof Error ? err.message : "That didn't save. Try again." };
  }
}

function refresh(id?: string) {
  revalidatePath("/os/automations/workflows");
  if (id) revalidatePath(`/os/automations/workflows/${id}`);
}

/** New workflow from a template, then straight into the builder. */
export async function createWorkflowAction(template: string, resourceSlug?: string): Promise<{ error: string }> {
  if (!isTemplateKey(template)) return { error: "Pick a starting point." };
  const r = await guard((w) => data.createWorkflow(w, template, resourceSlug));
  if (r.error !== undefined) return { error: r.error };
  refresh();
  redirect(`/os/automations/workflows/${(r as { id: string }).id}`);
}

export async function saveWorkflowDraft(id: string, input: { graph?: WorkflowGraph; name?: string }) {
  return guard((w) => data.saveDraft(w, id, input));
}

export async function publishWorkflowAction(id: string): Promise<Result<{ version?: number; problems?: GraphProblem[] }>> {
  const r = await guard((w) => data.publishWorkflow(w, id));
  if (r.error === undefined && "version" in r) refresh(id);
  return r;
}

export async function setWorkflowMode(id: string, mode: WorkflowMode) {
  if (mode !== "draft" && mode !== "auto") return { error: "Unknown mode." };
  const r = await guard(async (w) => {
    await data.setMode(w, id, mode);
    return {};
  });
  refresh(id);
  return r;
}

export async function setWorkflowOn(id: string, on: boolean) {
  const r = await guard(async (w) => {
    await data.setOn(w, id, on);
    return {};
  });
  refresh(id);
  return r;
}

export async function deleteWorkflowAction(id: string): Promise<{ error: string }> {
  const r = await guard(async (w) => {
    await data.deleteWorkflow(w, id);
    return {};
  });
  if (r.error !== undefined) return { error: r.error };
  refresh();
  redirect("/os/automations/workflows");
}

// ---------------------------------------------------------------- Inbox
export async function loadContactRun(contactId: string): Promise<ContactRun | null> {
  try {
    return await data.contactRun(await ws(), contactId);
  } catch {
    return null;
  }
}

export async function resumeContactRun(contactId: string) {
  const r = await guard(async (w) => {
    await data.resumeRun(w, contactId);
    return {};
  });
  revalidatePath("/os/inbox");
  return r;
}
