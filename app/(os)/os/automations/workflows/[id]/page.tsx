// Automations › Workflows › one workflow: the free-canvas builder (WorkflowA).

import { notFound } from "next/navigation";
import Builder from "@/components/os/workflows/builder";
import type { BuilderContext } from "@/components/os/workflows/context";
import { getWorkflow, workflowNames, workflowStats } from "@/components/os/workflows/data";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { loadLineTests, type StageLineRow } from "@/lib/os/experiments/data";
import { listCustomFields } from "@/lib/os/fields/store";
import type { StepData } from "@/lib/os/workflows/graph";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function WorkflowPage({ params }: PageProps) {
  const { id } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const workflow = await getWorkflow(workspaceId, id).catch(() => null);
  if (!workflow) notFound();

  const [stats, fields, resources, setters, workflows] = await Promise.all([
    workflowStats(workspaceId, id).catch(() => null),
    listCustomFields(workspaceId).catch(() => []),
    prisma.resource
      .findMany({ where: { workspaceId, kind: "resource" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true, name: true, link: true } })
      .catch(() => []),
    prisma.setter.findMany({ where: { workspaceId }, orderBy: [{ isDefault: "desc" }, { name: "asc" }], select: { id: true, name: true, isDefault: true } }).catch(() => []),
    workflowNames(workspaceId).catch(() => []),
  ]);

  // Line tests for the setters this workflow uses (the default one when unset).
  const fallback = setters.find((s) => s.isDefault)?.id ?? setters[0]?.id;
  const used = new Set<string>();
  for (const n of workflow.graph.nodes) if (n.type === "setter") used.add((n.data as StepData<"setter">).setterId || fallback || "");
  if (fallback) used.add(fallback);
  const lineTests: Record<string, StageLineRow[]> = {};
  await Promise.all(
    [...used]
      .filter((s) => setters.some((x) => x.id === s))
      .map(async (s) => {
        const rows = await loadLineTests(workspaceId, s).catch((err) => {
          console.error("[OS Workflows] line tests:", err);
          return null;
        });
        if (rows) lineTests[s] = rows;
      })
  );

  const ctx: Omit<BuilderContext, "stats"> = {
    fields: fields.map((f) => ({ key: f.key, label: f.label, kit: f.builtIn || Boolean(f.kitField), ghl: f.builtIn || Boolean(f.ghlField) })),
    resources,
    setters,
    workflows,
    lineTests,
  };

  return <Builder workflow={workflow} stats={stats} ctx={ctx} />;
}
