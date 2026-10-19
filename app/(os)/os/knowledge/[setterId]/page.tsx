import { notFound } from "next/navigation";
import { SetterHead } from "@/components/os/knowledge/kb-tabs";
import SetterEditor from "@/components/os/knowledge/setter-editor";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadSetterEditor } from "@/lib/os/knowledge";
import { osMockEnabled } from "@/lib/os/mock";
import { listVoiceClips, type VoiceClipView } from "@/lib/os/voice/clips";

export const dynamic = "force-dynamic";

export default async function SetterPage({ params }: { params: Promise<{ setterId: string }> }) {
  const { setterId } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const view = await loadSetterEditor(workspaceId, setterId);
  if (!view) notFound();
  const voiceClips: VoiceClipView[] = await listVoiceClips(workspaceId, view.id).catch((err) => {
    console.error("[OS Voice] clips failed:", err);
    return [];
  });
  return (
    <>
      <SetterHead id={view.id} name={view.name} active="knowledge" />
      <SetterEditor key={view.id} view={view} voiceClips={voiceClips} sampleData={osMockEnabled()} />
    </>
  );
}
