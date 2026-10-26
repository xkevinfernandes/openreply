// Resources (/os/resources, Resources canvas): one library of lead magnets,
// videos and knowledge docs. Each resource shows what uses it: agents that
// may offer it (SetterResource), campaigns mapped to it (CampaignResource),
// workflows whose current version hands it out, and "Sequences via J" when an
// agent offers it (J's sequences send what J may offer). The pure parts are
// exported for tests; the loader reads it all in one pass.

import { prisma } from "@/lib/db/client";
import { listResources } from "@/lib/os/knowledge";
import { osMockEnabled } from "@/lib/os/mock";
import { buildBoard, type ResourcesBoard } from "@/lib/os/resources-view";

export * from "@/lib/os/resources-view";

export async function loadResourcesBoard(workspaceId: string): Promise<ResourcesBoard> {
  const [resources, agents, maps, workflows] = await Promise.all([
    listResources(workspaceId),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }] }),
    prisma.campaignResource.findMany({ where: { workspaceId }, select: { automationId: true, resourceId: true } }).catch(() => []),
    prisma.workflow.findMany({ where: { workspaceId }, select: { id: true, name: true, currentVersionId: true, versions: { select: { id: true, graph: true } } } }).catch(() => []),
  ]);
  if (!resources.length && osMockEnabled()) {
    const { MOCK_LEAD_MAGNETS, mockResourcesBoard } = await import("@/lib/os/mock-resources");
    const { resourceBroadcastUse } = await import("@/lib/os/broadcasts/resources");
    const used = await resourceBroadcastUse(workspaceId, MOCK_LEAD_MAGNETS.map((r) => r.id)).catch(() => new Map());
    // The sheet offers the workspace's real setters (a sample one can't be saved to).
    return { ...mockResourcesBoard(used), agents };
  }
  const docs = agents.length
    ? await prisma.setterDoc.findMany({ where: { setterId: { in: agents.map((a) => a.id) }, body: { not: "" } }, select: { setterId: true, key: true } }).catch(() => [])
    : [];
  const names = maps.length
    ? await prisma.automation.findMany({ where: { workspaceId, id: { in: maps.map((m) => m.automationId) } }, select: { id: true, name: true } }).catch(() => [])
    : [];
  const { resourcesOfGraph } = await import("@/lib/os/workflows/engine");
  const wf = workflows.map((w) => {
    const graph = w.versions.find((v) => v.id === w.currentVersionId)?.graph as Parameters<typeof resourcesOfGraph>[0] | undefined;
    let slugs: string[] = [];
    try {
      slugs = graph && Array.isArray(graph.nodes) ? resourcesOfGraph(graph) : [];
    } catch {
      slugs = [];
    }
    return { id: w.id, name: w.name, slugs };
  });
  return buildBoard(
    resources,
    new Map(),
    {
      agents,
      campaigns: maps.map((m) => ({ ...m, name: names.find((n) => n.id === m.automationId)?.name ?? "A campaign" })),
      workflows: wf,
    },
    docs
  );
}
