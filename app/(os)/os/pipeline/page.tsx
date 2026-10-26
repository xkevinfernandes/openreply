import { redirect } from "next/navigation";
import type { OpenPanel } from "@/components/os/contacts/panel-host";
import PipelineScreen from "@/components/os/pipeline/setter-pipeline";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadContactDetails } from "@/lib/os/contact-panel/details";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import { panelTab } from "@/lib/os/contact-panel/types";
import { listContacts, type ContactsData } from "@/lib/os/contacts-board";
import { ALL_BOARD, pickSetter } from "@/lib/os/pipeline-board";
import { listTags } from "@/lib/os/tags/store";
import { workspaceCurrency } from "@/lib/os/won";

// Pipeline (dm-crm issue 019): one board per setter (?setter=), the default
// setter's when none is picked. The All · funnel board lives at
// /os/pipeline/all (Home stream); ?setter=all goes there.
export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ setter?: string; stage?: string; c?: string; contact?: string; tab?: string }> };

async function openPanel(workspaceId: string, contactId: string | undefined): Promise<OpenPanel | null> {
  if (!contactId) return null;
  try {
    const [panel, details] = await Promise.all([loadContactPanel(workspaceId, contactId), loadContactDetails(workspaceId, contactId)]);
    return panel ? { panel, details } : null;
  } catch (err) {
    console.error("[OS Pipeline] panel failed:", err);
    return null;
  }
}

async function load(workspaceId: string): Promise<{ data: ContactsData; tags: string[]; currency: string; now: number } | null> {
  try {
    const [data, tags, currency] = await Promise.all([listContacts(workspaceId), listTags(workspaceId).catch(() => []), workspaceCurrency(workspaceId)]);
    return { data, tags: tags.map((t) => t.name), currency, now: Date.now() };
  } catch (err) {
    console.error("[OS Pipeline] load failed:", err);
    return null;
  }
}

export default async function PipelinePage({ searchParams }: PageProps) {
  const params = await searchParams;
  if (params.setter === ALL_BOARD) redirect("/os/pipeline/all");
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const loaded = await load(workspaceId);
  if (!loaded) return <div className="os-banner">The pipeline didn&apos;t load. Refresh in a minute.</div>;
  const { data, tags, currency, now } = loaded;
  const open = await openPanel(workspaceId, params.c ?? params.contact);
  const setterId = pickSetter(data.setters, params.setter);

  return (
    <PipelineScreen
      key={setterId}
      contacts={data.contacts}
      setters={data.setters}
      setterId={setterId}
      tags={tags}
      currency={currency}
      truncated={data.truncated}
      now={now}
      focusKey={params.stage ?? null}
      initialOpen={open}
      initialTab={panelTab(params.tab, "chat")}
    />
  );
}
