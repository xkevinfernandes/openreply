import BroadcastList from "@/components/os/broadcasts/list";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadBroadcastList } from "@/lib/os/broadcasts/engine";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const items = await loadBroadcastList(workspaceId).catch((err) => {
    console.error("[OS Broadcasts] list failed:", err);
    return null;
  });
  return <BroadcastList items={items} />;
}
