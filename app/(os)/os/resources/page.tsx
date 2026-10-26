import ResourcesManager from "@/components/os/knowledge/resources-manager";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { listResources } from "@/lib/os/knowledge";

// Resources as its own place (Part C issue 023). Placeholder: today's
// resources list under the new route; the Settings+Resources stream restyles
// it to the Resources canvas and redirects /os/knowledge/resources here.
export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const resources = await listResources(workspaceId);
  return (
    <div className="kb-ws">
      <PageHead title="Resources" />
      <ResourcesManager resources={resources} />
    </div>
  );
}
