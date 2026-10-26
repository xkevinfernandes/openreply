"use server";

// Settings › Tags writes. Owners and admins only; every rule (system tags,
// taken names, aliases, delete refusal) is in lib/os/tags/store.ts.

import { revalidatePath } from "next/cache";
import { createTag, deleteTag, freeAlias, renameTag, setTagColor, type TagUsage } from "@/lib/os/tags/store";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

type Done = { ok: true } | { ok: false; error: string };

async function manager(): Promise<string | { ok: false; error: string }> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, error: "Sign in again." };
  if (!canManageWorkspace(context.role)) return { ok: false, error: "Only workspace owners and admins can change tags." };
  return context.workspaceId;
}

function refresh() {
  revalidatePath("/os/settings");
  revalidatePath("/os/contacts");
  revalidatePath("/os/inbox");
}

async function guarded<T extends Done>(fn: (ws: string) => Promise<T>): Promise<T | { ok: false; error: string }> {
  const ws = await manager();
  if (typeof ws !== "string") return ws;
  try {
    const r = await fn(ws);
    if (r.ok) refresh();
    return r;
  } catch (err) {
    console.error("[OS Tags]", err);
    return { ok: false, error: "That didn't save. Try again." };
  }
}

export async function addTagAction(name: string, color: string): Promise<Done> {
  return guarded(async (ws) => {
    const r = await createTag(ws, { name, color });
    return r.ok ? { ok: true } : r;
  });
}

/** Edit: rename (only when a new name is sent; system tags never get one), then recolour. */
export async function editTagAction(id: string, input: { name?: string; color: string }): Promise<Done> {
  return guarded(async (ws) => {
    if (input.name !== undefined) {
      const renamed = await renameTag(ws, id, input.name);
      if (!renamed.ok) return renamed;
    }
    const c = await setTagColor(ws, id, input.color);
    return c.ok ? { ok: true } : c;
  });
}

export async function recolourTagAction(id: string, color: string): Promise<Done> {
  return guarded(async (ws) => {
    const r = await setTagColor(ws, id, color);
    return r.ok ? { ok: true } : r;
  });
}

export async function deleteTagAction(id: string, force = false): Promise<Done | { ok: false; error: string; usage?: TagUsage }> {
  return guarded(async (ws) => deleteTag(ws, id, { force }));
}

export async function freeAliasAction(aliasId: string): Promise<Done> {
  return guarded(async (ws) => {
    const r = await freeAlias(ws, aliasId);
    return r.ok ? { ok: true } : { ok: false, error: "That old name is already free." };
  });
}
