import "./resources.css";
import ResourcesScreen from "@/components/os/resources/resources-screen";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadResourcesBoard } from "@/lib/os/resources-board";

// Resources as its own place (Part C 023): lead magnets, videos and
// knowledge docs, with what uses each one.
export const dynamic = "force-dynamic";

export default async function ResourcesPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  return <ResourcesScreen board={await loadResourcesBoard(workspaceId)} />;
}
