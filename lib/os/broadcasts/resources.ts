// Resources in broadcasts (dm-agents Part C issue 024): the Messages step's
// picker lists resources (only ones with a link can be picked), "+ New
// resource" makes one with its link required, Resources › Used by lists the
// broadcasts whose link bubbles use it, and delete is refused while an
// unsent broadcast uses it. Sent broadcasts keep the link they stored.

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { cleanLink } from "@/lib/os/broadcasts/template";
import type { BroadcastBubble, BroadcastStatus } from "@/lib/os/broadcasts/types";
import { parseBubbles } from "@/lib/os/broadcasts/types";

export interface PickerResource {
  id: string;
  name: string;
  /** Null: greyed in the picker ("add a link first"). */
  link: string | null;
}

const mockMade: PickerResource[] = ((globalThis as { __osMockBroadcastResources?: PickerResource[] }).__osMockBroadcastResources ??= []);

export async function listPickerResources(workspaceId: string): Promise<PickerResource[]> {
  if (osMockEnabled()) {
    const { mockResources } = await import("@/lib/os/mock-followups");
    return [...mockResources(), ...mockMade];
  }
  return prisma.resource.findMany({
    where: { workspaceId, kind: "resource" },
    select: { id: true, name: true, link: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });
}

/** "+ New resource" from the picker: name and a link (required). */
export async function createLinkResource(workspaceId: string, input: { name: string; link: string }): Promise<{ ok: true; resource: { id: string; name: string; link: string } } | { ok: false; error: string }> {
  const name = input.name.trim().slice(0, 160);
  if (!name) return { ok: false, error: "Give it a name." };
  const link = cleanLink(input.link);
  if (!link) return { ok: false, error: "Add its link (the full URL)." };
  if (osMockEnabled()) {
    const r = { id: `res-new-${mockMade.length + 1}`, name, link };
    mockMade.push(r);
    return { ok: true, resource: r };
  }
  const { slugify } = await import("@/lib/os/setter/kb");
  let slug = slugify(name);
  for (let i = 2; await prisma.resource.findFirst({ where: { workspaceId, slug }, select: { id: true } }); i++) slug = `${slugify(name)}-${i}`;
  const max = await prisma.resource.aggregate({ where: { workspaceId }, _max: { sortOrder: true } });
  const row = await prisma.resource.create({ data: { workspaceId, slug, kind: "resource", name, link, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  return { ok: true, resource: { id: row.id, name: row.name, link } };
}

export interface ResourceBroadcastUse {
  key: string;
  name: string;
  status: BroadcastStatus;
  /** Not sent yet: delete is refused. */
  unsent: boolean;
}

/** Pure: which broadcasts' link bubbles use a resource. */
export function broadcastsUsing(resourceId: string, broadcasts: { key: string; name: string; status: string; bubbles: unknown }[]): ResourceBroadcastUse[] {
  return broadcasts
    .filter((b) => parseBubbles(b.bubbles).some((x: BroadcastBubble) => x.type === "link" && x.resourceId === resourceId))
    .map((b) => ({ key: b.key, name: b.name, status: b.status as BroadcastStatus, unsent: b.status !== "sent" && b.status !== "cancelled" }));
}

export async function resourceBroadcastUse(workspaceId: string, resourceIds: string[]): Promise<Map<string, ResourceBroadcastUse[]>> {
  const out = new Map<string, ResourceBroadcastUse[]>();
  if (!resourceIds.length) return out;
  const rows = osMockEnabled()
    ? (await (await import("@/lib/os/mock-followups")).mockBroadcastStore().list(workspaceId)).map((b) => ({ key: b.key, name: b.name, status: b.status, bubbles: b.bubbles }))
    : await prisma.broadcast.findMany({ where: { workspaceId }, select: { key: true, name: true, status: true, bubbles: true }, orderBy: { createdAt: "desc" } });
  for (const id of resourceIds) out.set(id, broadcastsUsing(id, rows));
  return out;
}

/** Why a resource can't be deleted (an unsent broadcast uses it as a link), or null. */
export function deleteBlockedBy(uses: ResourceBroadcastUse[]): string | null {
  const unsent = uses.filter((u) => u.unsent);
  if (!unsent.length) return null;
  return `${unsent.map((u) => u.name).join(", ")} ${unsent.length === 1 ? "uses" : "use"} it as a link. Change ${unsent.length === 1 ? "that broadcast" : "those broadcasts"} first.`;
}
