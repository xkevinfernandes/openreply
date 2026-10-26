import BroadcastList from "@/components/os/broadcasts/list";
import { listWorkflows } from "@/components/os/workflows/data";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { automationTabCounts } from "@/lib/os/automations-data";
import { loadBroadcastList } from "@/lib/os/broadcasts/engine";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const [items, counts, workflows] = await Promise.all([
    loadBroadcastList(workspaceId).catch((err) => {
      console.error("[OS Broadcasts] list failed:", err);
      return null;
    }),
    automationTabCounts(workspaceId).catch(() => ({ campaigns: 0, broadcasts: 0 })),
    listWorkflows(workspaceId).catch(() => []),
  ]);
  return <BroadcastList items={items} counts={{ ...counts, workflows: workflows.length }} />;
}
