import { redirect } from "next/navigation";
import ContactsScreen, { type OpenPanel, type TagOption } from "@/components/os/contacts/contacts-screen";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadContactDetails } from "@/lib/os/contact-panel/details";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import { panelTab } from "@/lib/os/contact-panel/types";
import { listContacts, type ContactsData } from "@/lib/os/contacts-board";
import { listViews, type SavedViewRecord } from "@/lib/os/saved-views";
import { listTags } from "@/lib/os/tags/store";
import { boardRedirect, type BoardLinkParams } from "@/lib/os/pipeline-board";
import { workspaceCurrency } from "@/lib/os/won";

// Contacts is a table of people (dm-crm issue 017). The board moved to
// /os/pipeline; old board links (?view=kanban, ?stage=, ?setter=) go there.

type Params = BoardLinkParams;
type PageProps = { searchParams: Promise<Params> };

interface Loaded {
  data: ContactsData;
  tags: TagOption[];
  views: SavedViewRecord[];
  currency: string;
  error: string | null;
  now: number;
}

async function load(workspaceId: string): Promise<Loaded> {
  try {
    const [data, tags, views, currency] = await Promise.all([listContacts(workspaceId), listTags(workspaceId), listViews(workspaceId), workspaceCurrency(workspaceId)]);
    return { data, tags: tags.map((t) => ({ id: t.id, name: t.name, color: t.color })), views, currency, error: null, now: Date.now() };
  } catch (err) {
    console.error("[OS Contacts] load failed:", err);
    return { data: { contacts: [], setters: [], truncated: false }, tags: [], views: [], currency: "EUR", error: "Contacts didn't load. Refresh in a minute.", now: Date.now() };
  }
}

/** ?c=<contactId> opens the push panel on first paint. */
async function openPanel(workspaceId: string, contactId: string | undefined): Promise<OpenPanel | null> {
  if (!contactId) return null;
  try {
    const [panel, details] = await Promise.all([loadContactPanel(workspaceId, contactId), loadContactDetails(workspaceId, contactId)]);
    return panel ? { panel, details } : null;
  } catch (err) {
    console.error("[OS Contacts] panel failed:", err);
    return null;
  }
}

export default async function ContactsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const to = boardRedirect(params);
  if (to) redirect(to);

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const [loaded, open] = await Promise.all([load(workspaceId), openPanel(workspaceId, params.c ?? params.contact)]);
  if (loaded.error) return <div className="os-banner">{loaded.error}</div>;
  const { data } = loaded;
  return (
    <ContactsScreen
      contacts={data.contacts}
      setters={data.setters}
      fieldColumns={data.fieldColumns ?? []}
      tags={loaded.tags}
      views={loaded.views}
      initialViewId={params.view ?? null}
      currency={loaded.currency}
      truncated={data.truncated}
      now={loaded.now}
      initialOpen={open}
      initialTab={panelTab(params.tab, "chat")}
    />
  );
}
