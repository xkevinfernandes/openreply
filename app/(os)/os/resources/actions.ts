"use server";

// Resources writes: the add/edit sheet (resource fields + which agents may
// offer it) and delete with its refusal. Field rules stay in the Knowledge
// bases action (saveResource); this adds the agent links and the checks.

import { revalidatePath } from "next/cache";
import { deleteResource, saveResource, type ResourceForm } from "@/app/(os)/os/knowledge/actions";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { deleteBlockers, loadResourcesBoard, offeringAgents, type UsedBy } from "@/lib/os/resources-board";

export interface SavedResource {
  id: string;
  name: string;
  kind: ResourceForm["kind"];
  link: string | null;
}

const SAMPLE = "Sample data (OS_MOCK). Add a real resource to change things.";
const isSample = (id?: string) => Boolean(id?.startsWith("mock-res-"));

function refresh() {
  revalidatePath("/os/resources");
  revalidatePath("/os/knowledge", "layout");
}

/** Save the resource, then make exactly these agents the ones that may offer it. */
export async function saveResourceSheet(form: ResourceForm, agentIds: string[]): Promise<{ error?: string; resource?: SavedResource }> {
  if (isSample(form.id)) return { error: SAMPLE };
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  const saved = await saveResource(form);
  if (saved.error || !saved.id) return { error: saved.error ?? "That didn't save. Try again." };
  try {
    const own = await prisma.setter.findMany({ where: { workspaceId, id: { in: agentIds.slice(0, 100) } }, select: { id: true } });
    const keep = own.map((s) => s.id);
    await prisma.$transaction([
      prisma.setterResource.deleteMany({ where: { resourceId: saved.id, setterId: { notIn: keep } } }),
      prisma.setterResource.createMany({ data: keep.map((setterId) => ({ setterId, resourceId: saved.id! })), skipDuplicates: true }),
    ]);
    const row = await prisma.resource.findFirst({ where: { id: saved.id, workspaceId }, select: { id: true, name: true, kind: true, link: true } });
    refresh();
    return row ? { resource: { id: row.id, name: row.name, kind: row.kind as ResourceForm["kind"], link: row.link } } : { error: "That resource is gone. Refresh the page." };
  } catch (err) {
    console.error("[OS Resources]", err);
    return { error: "Saved, but the agents didn't update. Try again." };
  }
}

/**
 * Delete: refused while a campaign or a workflow's current version uses it
 * (naming each). When agents offer it, the first call returns them to
 * confirm; the agent links go with the resource.
 */
export async function deleteResourceChecked(id: string, confirmed = false): Promise<{ ok?: true; error?: string; blockers?: UsedBy[]; agents?: UsedBy[] }> {
  if (isSample(id)) return { error: SAMPLE };
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  const board = await loadResourcesBoard(workspaceId);
  const row = [...board.rows, ...board.entries].find((r) => r.id === id);
  if (!row) return { error: "That resource is gone. Refresh the page." };
  const blockers = deleteBlockers(row.usedByAll);
  if (blockers.length) return { error: `Used by ${blockers.map((b) => b.name).join(", ")}. Remove it there first.`, blockers };
  const agents = offeringAgents(row.usedByAll);
  if (agents.length && !confirmed) return { agents };
  const r = await deleteResource(id);
  if (r.error) return { error: r.error };
  refresh();
  return { ok: true };
}
