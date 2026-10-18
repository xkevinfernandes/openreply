import { notFound } from "next/navigation";
import { SetterHead } from "@/components/os/knowledge/kb-tabs";
import Sandbox from "@/components/os/knowledge/sandbox";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getSetterConfig } from "@/lib/os/setter/config";
import { dbKnowledge } from "@/lib/os/setter/setters";
import { entryOpener } from "@/lib/os/setter/sandbox";

export const dynamic = "force-dynamic";

export default async function SandboxPage({ params }: { params: Promise<{ setterId: string }> }) {
  const { setterId } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const setter = await dbKnowledge.forSetter(workspaceId, setterId);
  if (!setter) notFound();
  const entries = setter.catalog.resources
    .filter((r) => r.type === "setter")
    .map((r) => ({ slug: r.slug, name: r.name ?? r.slug, opener: entryOpener(setter, r.slug) }))
    .filter((e): e is { slug: string; name: string; opener: string } => Boolean(e.opener));
  return (
    <>
      <SetterHead id={setterId} name={setter.profile.name} active="sandbox" />
      <Sandbox setterId={setterId} setterName={setter.profile.name} entries={entries} backend={getSetterConfig().drafter.backend} />
    </>
  );
}
