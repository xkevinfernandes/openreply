import { KbTabs } from "@/components/os/knowledge/kb-tabs";
import ResourcesManager from "@/components/os/knowledge/resources-manager";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { listResources } from "@/lib/os/knowledge";

export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const resources = await listResources(workspaceId);
  return (
    <>
      <PageHead
        title="Knowledge bases"
        description="One resource list for the whole workspace. Each knowledge base switches resources on or off for J."
      />
      <KbTabs active="resources" />
      <ResourcesManager resources={resources} />
    </>
  );
}
