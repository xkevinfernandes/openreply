import { notFound } from "next/navigation";
import BroadcastBuilder from "@/components/os/broadcasts/builder";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { loadBroadcast } from "@/lib/os/broadcasts/engine";
import { listPickerResources } from "@/lib/os/broadcasts/resources";
import { osMockEnabled } from "@/lib/os/mock";

export const dynamic = "force-dynamic";

/** The agents J can write as (the default first). The sample has one, J. */
async function setterOptions(workspaceId: string): Promise<{ id: string; name: string; isDefault: boolean }[]> {
  const rows = await prisma.setter
    .findMany({ where: { workspaceId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } })
    .catch(() => []);
  if (!rows.length && osMockEnabled()) return [{ id: "setter-j", name: "J · Sales", isDefault: true }];
  return rows;
}

async function tagOptions(workspaceId: string): Promise<{ id: string; name: string }[]> {
  try {
    const { listTags } = await import("@/lib/os/tags/store");
    return (await listTags(workspaceId)).map((t) => ({ id: t.id, name: t.name }));
  } catch {
    return [];
  }
}

export default async function BroadcastPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const [data, setters, tags, resources] = await Promise.all([
    loadBroadcast(workspaceId, key),
    setterOptions(workspaceId),
    tagOptions(workspaceId),
    listPickerResources(workspaceId).catch(() => []),
  ]);
  if (!data) notFound();
  // Keyed by broadcast: opening another one (Duplicate, New) starts fresh.
  return <BroadcastBuilder key={data.broadcast.key} data={data} setters={setters} tags={tags} resources={resources} />;
}
