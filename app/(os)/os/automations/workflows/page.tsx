// Automations › Workflows (WorkflowsList board): Workflows · Campaigns ·
// Broadcasts, the list, and "New workflow" with the template picker.

import { AutomationsTabs } from "@/components/os/automations/automations-tabs";
import { listWorkflows } from "@/components/os/workflows/data";
import WorkflowList, { NewWorkflowButton } from "@/components/os/workflows/workflow-list";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { automationTabCounts } from "@/lib/os/automations-data";

export const dynamic = "force-dynamic";

export default async function WorkflowsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const [rows, counts, firstResource] = await Promise.all([
    listWorkflows(workspaceId).catch((err) => {
      console.error("[OS Workflows] list:", err);
      return [];
    }),
    automationTabCounts(workspaceId).catch(() => ({ campaigns: 0, broadcasts: 0 })),
    prisma.resource
      .findFirst({ where: { workspaceId, kind: "resource" }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { slug: true } })
      .catch(() => null),
  ]);

  return (
    <div className="os-auto wf-page">
      <header className="os-auto-head">
        <h1>Automations</h1>
        <NewWorkflowButton resourceSlug={firstResource?.slug} />
      </header>
      <AutomationsTabs active="workflows" counts={{ ...counts, workflows: rows.length }} />
      <WorkflowList rows={rows} />
    </div>
  );
}
