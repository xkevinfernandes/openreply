// Settings › Tags: one row per managed tag with its contact count, what uses
// it, its Kit name and its old names. The rules (rename, delete, free an
// alias) live in lib/os/tags/store.ts; this only reads, in one pass.

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { buildTagBoard, type TagBoard } from "@/lib/os/tags/board-view";
import { listTagAliases, listTags } from "@/lib/os/tags/store";

export { buildTagBoard, usedByWords, type TagBoard, type TagRow } from "@/lib/os/tags/board-view";

export async function loadTagBoard(workspaceId: string): Promise<TagBoard> {
  const [tags, aliases] = await Promise.all([listTags(workspaceId), listTagAliases(workspaceId)]);
  if (osMockEnabled()) {
    const { mockTagUsage } = await import("@/lib/os/mock-crm");
    const usage = await Promise.all(tags.map((t) => mockTagUsage(workspaceId, t.id)));
    const counts = new Map(tags.map((t, i) => [t.name, usage[i].contacts]));
    const broadcasts = usage.flatMap((u, i) => u.broadcasts.map((b) => ({ id: b.id, name: b.name, audienceTagId: tags[i].id })));
    return buildTagBoard(tags, aliases, counts, broadcasts, []);
  }
  const [counts, broadcasts, workflows] = await Promise.all([
    prisma.$queryRaw<{ name: string; n: bigint }[]>`SELECT t AS name, COUNT(*)::bigint AS n FROM "Contact", unnest("tags") AS t WHERE "workspaceId" = ${workspaceId} GROUP BY t`,
    prisma.broadcast.findMany({ where: { workspaceId, audienceTagId: { not: null }, status: { notIn: ["sent", "cancelled"] } }, select: { id: true, name: true, audienceTagId: true } }),
    prisma.workflow.findMany({ where: { workspaceId }, select: { id: true, name: true, draftGraph: true, currentVersionId: true, versions: { select: { id: true, graph: true } } } }),
  ]);
  return buildTagBoard(
    tags,
    aliases,
    new Map(counts.map((c) => [c.name, Number(c.n)])),
    broadcasts,
    workflows.map((w) => ({
      id: w.id,
      name: w.name,
      text: JSON.stringify(w.draftGraph ?? null) + JSON.stringify(w.versions.find((v) => v.id === w.currentVersionId)?.graph ?? null),
    }))
  );
}
