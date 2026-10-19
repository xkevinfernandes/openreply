import { notFound } from "next/navigation";
import DocEditor from "@/components/os/knowledge/doc-editor";
import { SetterBar } from "@/components/os/knowledge/kb-tabs";
import SetupPane from "@/components/os/knowledge/setter-editor";
import { isSetupKey, pageOf, SetterTree, type TreeSel } from "@/components/os/knowledge/setter-tree";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadSetterEditor } from "@/lib/os/knowledge";
import { osMockEnabled } from "@/lib/os/mock";
import { correctionPair } from "@/lib/os/setter/knowledge/corrections";
import { isDocKey } from "@/lib/os/setter/knowledge/docs";
import { listVoiceClips, type VoiceClipView } from "@/lib/os/voice/clips";

export const dynamic = "force-dynamic";

type Search = { f?: string | string[]; s?: string | string[] };

export default async function SetterPage({ params, searchParams }: { params: Promise<{ setterId: string }>; searchParams: Promise<Search> }) {
  const [{ setterId }, q] = await Promise.all([params, searchParams]);
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const view = await loadSetterEditor(workspaceId, setterId);
  if (!view) notFound();

  const f = Array.isArray(q.f) ? q.f[0] : q.f;
  const s = Array.isArray(q.s) ? q.s[0] : q.s;
  const sel: TreeSel = isSetupKey(s) ? { setup: s } : { file: isDocKey(f) ? f : "system_prompt" };
  const query = "file" in sel ? `?f=${sel.file}` : `?s=${pageOf(sel.setup)}`;

  let pane: React.ReactNode;
  if ("file" in sel) {
    const doc = view.docs.find((d) => d.key === sel.file)!;
    pane = (
      <DocEditor
        key={`${view.id}:${sel.file}`}
        setterId={view.id}
        setterName={view.name}
        docKey={sel.file}
        initialBody={doc.body}
        updatedAt={doc.updatedAt}
        revisions={doc.revisions}
        corrections={view.voiceCorrections.slice(-3).reverse().map(correctionPair)}
        correctionsTotal={view.voiceCorrections.length}
      />
    );
  } else {
    const page = pageOf(sel.setup);
    const voiceClips: VoiceClipView[] =
      page === "voice-notes"
        ? await listVoiceClips(workspaceId, view.id).catch((err) => {
            console.error("[OS Voice] clips failed:", err);
            return [];
          })
        : [];
    pane = <SetupPane key={`${view.id}:${page}`} view={view} page={page as Exclude<typeof page, "fields" | "follow-ups">} voiceClips={voiceClips} sampleData={osMockEnabled()} />;
  }

  return (
    <div className="kb-ws">
      <SetterBar id={view.id} name={view.name} setters={view.setters} query={query} />
      <div className="kb-body">
        <SetterTree view={view} sel={sel} />
        {pane}
      </div>
    </div>
  );
}
