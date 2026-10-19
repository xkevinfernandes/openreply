import { notFound } from "next/navigation";
import BroadcastBuilder from "@/components/os/broadcasts/builder";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadBuilder } from "@/lib/os/broadcasts/engine";

export const dynamic = "force-dynamic";

export default async function BroadcastPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const data = await loadBuilder(workspaceId, key);
  if (!data) notFound();
  // Keyed by run + messages so a server refresh resets the drafts' local edits.
  return <BroadcastBuilder key={`${data.run?.id ?? "none"}:${data.broadcast.windowStart}-${data.broadcast.windowEnd}:${data.broadcast.windowDay}`} data={data} />;
}
