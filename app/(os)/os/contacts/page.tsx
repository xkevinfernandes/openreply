import ContactsScreen, { type OpenPanel } from "@/components/os/contacts/contacts-screen";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadContactDetails } from "@/lib/os/contact-panel/details";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import { panelTab } from "@/lib/os/contact-panel/types";
import { listContacts, type ContactsData } from "@/lib/os/contacts-board";

type PageProps = { searchParams: Promise<{ view?: string; c?: string; contact?: string; tab?: string; stage?: string; setter?: string }> };

async function load(workspaceId: string): Promise<{ data: ContactsData; error: string | null; now: number }> {
  try {
    return { data: await listContacts(workspaceId), error: null, now: Date.now() };
  } catch (err) {
    console.error("[OS Contacts] load failed:", err);
    return { data: { contacts: [], setters: [], truncated: false }, error: "Contacts didn't load. Refresh in a minute.", now: Date.now() };
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
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const params = await searchParams;
  const view = params.view === "table" ? "table" : "kanban";
  const [{ data, error, now }, open] = await Promise.all([load(workspaceId), openPanel(workspaceId, params.c ?? params.contact)]);

  if (error) return <div className="os-banner">{error}</div>;
  return (
    <ContactsScreen
      contacts={data.contacts}
      setters={data.setters}
      truncated={data.truncated}
      initialView={view}
      now={now}
      initialOpen={open}
      initialTab={panelTab(params.tab, "chat")}
      initialSetter={params.setter ?? null}
      focusColumn={params.stage ?? null}
    />
  );
}
