import { PageHead } from "@/components/os/page-head";
import IntegrationsBoard from "@/components/os/integrations/board";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { calendarBoard } from "@/lib/os/integrations/calendar/view";
import { integrationsView } from "@/lib/os/integrations/view";

async function load(workspaceId: string) {
  const [views, calendars] = await Promise.all([integrationsView(workspaceId), calendarBoard(workspaceId)]);
  return { views, calendars, now: Date.now() };
}

export default async function IntegrationsPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return null;
  const { views, calendars, now } = await load(context.workspaceId);

  return (
    <>
      <PageHead
        title="Integrations"
        description="Send your contacts to your email list and CRM, and let J book calls on your calendar."
      />
      <IntegrationsBoard views={views} calendars={calendars} canManage={canManageWorkspace(context.role)} now={now} />
    </>
  );
}
