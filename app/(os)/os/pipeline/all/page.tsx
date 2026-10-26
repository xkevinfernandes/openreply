import Link from "next/link";
import { FunnelBoard } from "@/components/os/pipeline/funnel-board";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadAllBoard } from "@/lib/os/home-funnel";
import { getWorkspaceSettings } from "@/lib/os/workspace-settings";

// Pipeline › All · funnel (dm-crm 032): every setter's contacts on the
// shared funnel's steps. The per-setter boards live at /os/pipeline.
export const dynamic = "force-dynamic";

export default async function PipelineAllPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const [data, settings] = await Promise.all([loadAllBoard(workspaceId), getWorkspaceSettings(workspaceId).catch(() => null)]);
  return (
    <div className="os-pipeline os-pipeline-all">
      <PageHead
        title="Pipeline"
        actions={
          <nav className="os-fb-tabs" aria-label="Board">
            <Link href="/os/pipeline/all" aria-current="page">
              All · funnel
            </Link>
            <Link href="/os/pipeline">Per setter</Link>
          </nav>
        }
      />
      <FunnelBoard data={data} currency={settings?.currency ?? "EUR"} />
    </div>
  );
}
