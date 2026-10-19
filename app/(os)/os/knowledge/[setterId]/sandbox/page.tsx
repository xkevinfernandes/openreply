import { notFound } from "next/navigation";
import { SetterHead } from "@/components/os/knowledge/kb-tabs";
import Sandbox from "@/components/os/knowledge/sandbox";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { experimentStore } from "@/lib/os/experiments/store";
import { sendableResources } from "@/lib/os/setter/agent/context";
import { getSetterConfig } from "@/lib/os/setter/config";
import { dbKnowledge } from "@/lib/os/setter/setters";
import { entryOpener } from "@/lib/os/setter/sandbox";
import { testLinesFrom } from "@/lib/os/setter/sandbox-options";

export const dynamic = "force-dynamic";

export default async function SandboxPage({ params }: { params: Promise<{ setterId: string }> }) {
  const { setterId } = await params;
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;
  const setter = await dbKnowledge.forSetter(workspaceId, setterId);
  if (!setter) notFound();
  const entries = setter.catalog.resources
    .filter((r) => r.type === "setter")
    .map((r) => ({ slug: r.slug, name: r.name ?? r.slug, keyword: r.triggers?.find((t) => t.keyword)?.keyword ?? r.zernio?.keyword ?? null, opener: entryOpener(setter, r.slug) }))
    .filter((e): e is { slug: string; name: string; keyword: string | null; opener: string } => Boolean(e.opener));
  const magnets = [...sendableResources(setter, null).values()].filter((r) => r.kind !== "booking" && r.kind !== "episode").map((r) => ({ slug: r.slug, title: r.title }));
  // Read only: the running line tests this setter takes part in.
  const tests = testLinesFrom(await experimentStore().list(workspaceId).catch(() => []), setterId);
  const setters = await prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: { createdAt: "asc" } });
  return (
    <div className="kb-ws">
      <SetterHead id={setterId} name={setter.profile.name} setters={setters} />
      <Sandbox setterId={setterId} setterName={setter.profile.name} entries={entries} magnets={magnets} tests={tests} backend={getSetterConfig().drafter.backend} />
    </div>
  );
}
