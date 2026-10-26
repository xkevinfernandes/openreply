import { BoardSwitch } from "@/components/os/pipeline/board-switch";
import { FunnelBoard } from "@/components/os/pipeline/funnel-board";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { boardSetters } from "@/lib/os/contacts-board";
import { loadAllBoard } from "@/lib/os/home-funnel";
import { ALL_BOARD } from "@/lib/os/pipeline-board";
import { getWorkspaceSettings } from "@/lib/os/workspace-settings";

// Pipeline › All · funnel (dm-crm 032): every setter's contacts on the
// shared funnel's steps. The per-setter boards live at /os/pipeline.
export const dynamic = "force-dynamic";

export default async function PipelineAllPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const [data, settings, setters] = await Promise.all([loadAllBoard(workspaceId), getWorkspaceSettings(workspaceId).catch(() => null), boardSetters(workspaceId)]);
  return (
    <div className="os-pipeline os-pipeline-all">
      <PageHead title="Pipeline" />
      <div className="os-pl-switch">
        <BoardSwitch setters={setters} value={ALL_BOARD} />
      </div>
      <FunnelBoard data={data} currency={settings?.currency ?? "EUR"} />
    </div>
  );
}
