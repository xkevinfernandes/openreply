import { redirect } from "next/navigation";
import { KbTabs } from "@/components/os/knowledge/kb-tabs";
import { ImportButton, NewSetter } from "@/components/os/knowledge/setter-list-actions";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/** Knowledge bases opens on the default setter (J). */
export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ s?: string | string[] }> }) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const first =
    (await prisma.setter.findFirst({ where: { workspaceId, isDefault: true }, orderBy: { createdAt: "asc" }, select: { id: true } })) ??
    (await prisma.setter.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select: { id: true } }));
  // ?s= opens a Setup page on it (⌘K "Tests", old Automations › Tests links).
  const s = (await searchParams).s;
  const page = typeof s === "string" && /^[a-z-]+$/.test(s) ? `?s=${s}` : "";
  if (first) redirect(`/os/knowledge/${first.id}${page}`);

  return (
    <div className="kb-ws">
      <header className="kb-bar">
        <h1 className="kb-title">Knowledge bases</h1>
      </header>
      <KbTabs active="setters" />
      <div className="kb-pad">
        <div className="os-empty os-kb-empty">
          <strong>No setter yet</strong>
          <p>J drafts from the bundled claudepreneur files until you import them.</p>
          <div className="os-kb-inline">
            <ImportButton />
            <NewSetter setters={[]} />
          </div>
        </div>
      </div>
    </div>
  );
}
