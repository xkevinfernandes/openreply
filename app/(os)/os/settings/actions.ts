"use server";

// Settings writes: global custom fields (Custom fields tab) and the sending
// switches (Workspace tab). Owners and admins only.

import { revalidatePath } from "next/cache";
import { createCustomField, deleteCustomField, updateCustomField } from "@/lib/os/fields/store";
import type { CustomFieldView, FieldInput } from "@/lib/os/fields/types";
import { updateWorkspaceSettings, type WorkspaceSettings } from "@/lib/os/workspace-settings";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

async function manager(): Promise<string | { error: string }> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { error: "Sign in again." };
  if (!canManageWorkspace(context.role)) return { error: "Only workspace owners and admins can change this." };
  return context.workspaceId;
}

function refresh() {
  revalidatePath("/os/settings");
  revalidatePath("/os/contacts");
  revalidatePath("/os/knowledge", "layout");
}

export async function addField(input: Partial<FieldInput>): Promise<{ field: CustomFieldView } | { error: string }> {
  const ws = await manager();
  if (typeof ws !== "string") return ws;
  try {
    const r = await createCustomField(ws, input);
    if ("field" in r) refresh();
    return r;
  } catch (err) {
    console.error("[OS Fields] create failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

export async function editField(id: string, input: Partial<FieldInput>): Promise<{ field: CustomFieldView } | { error: string }> {
  const ws = await manager();
  if (typeof ws !== "string") return ws;
  try {
    const r = await updateCustomField(ws, id, input);
    if ("field" in r) refresh();
    return r;
  } catch (err) {
    console.error("[OS Fields] update failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

export async function removeField(id: string): Promise<{ ok: true } | { error: string }> {
  const ws = await manager();
  if (typeof ws !== "string") return ws;
  try {
    const r = await deleteCustomField(ws, id);
    if ("ok" in r) refresh();
    return r;
  } catch (err) {
    console.error("[OS Fields] delete failed:", err);
    return { error: "That didn't delete. Try again." };
  }
}

/** Daily send cap and timezone (Pause all lives in the sidebar foot). */
export async function saveSending(input: { sendCapPerDay?: number; timezone?: string }): Promise<WorkspaceSettings | { error: string }> {
  const ws = await manager();
  if (typeof ws !== "string") return ws;
  try {
    const r = await updateWorkspaceSettings(ws, input);
    if (!("error" in r)) revalidatePath("/os", "layout");
    return r;
  } catch (err) {
    console.error("[OS Settings] sending failed:", err);
    return { error: "That didn't save. Try again." };
  }
}
