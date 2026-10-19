import { KbTabs } from "@/components/os/knowledge/kb-tabs";
import ResourcesManager from "@/components/os/knowledge/resources-manager";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { listResources } from "@/lib/os/knowledge";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const [resources, first] = await Promise.all([
    listResources(workspaceId),
    prisma.setter.findFirst({ where: { workspaceId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], select: { id: true } }),
  ]);
  return (
    <div className="kb-ws">
      <header className="kb-bar">
        <h1 className="kb-title">Knowledge bases</h1>
      </header>
      <KbTabs active="resources" settersHref={first ? `/os/knowledge/${first.id}` : "/os/knowledge"} />
      <ResourcesManager resources={resources} />
    </div>
  );
}
