import { PageHead } from "@/components/os/page-head";
import IntegrationsBoard from "@/components/os/integrations/board";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { integrationsView } from "@/lib/os/integrations/view";

async function load(workspaceId: string) {
  return { views: await integrationsView(workspaceId), now: Date.now() };
}

export default async function IntegrationsPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return null;
  const { views, now } = await load(context.workspaceId);

  return (
    <>
      <PageHead
        title="Integrations"
        description="Send your contacts to your email list and CRM. One way: changes here go there, nothing comes back."
      />
      <IntegrationsBoard views={views} canManage={canManageWorkspace(context.role)} now={now} />
    </>
  );
}
