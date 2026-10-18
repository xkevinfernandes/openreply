import ContactsScreen from "@/components/os/contacts/contacts-screen";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { listContacts, type ContactsData } from "@/lib/os/contacts-board";

type PageProps = { searchParams: Promise<{ view?: string }> };

async function load(workspaceId: string): Promise<{ data: ContactsData; error: string | null; now: number }> {
  try {
    return { data: await listContacts(workspaceId), error: null, now: Date.now() };
  } catch (err) {
    console.error("[OS Contacts] load failed:", err);
    return { data: { contacts: [], setters: [], truncated: false }, error: "Contacts didn't load. Refresh in a minute.", now: Date.now() };
  }
}

export default async function ContactsPage({ searchParams }: PageProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return null;

  const params = await searchParams;
  const view = params.view === "table" ? "table" : "kanban";
  const { data, error, now } = await load(workspaceId);

  return (
    <>
      <PageHead title="Contacts" description="Everyone who wrote in, as a table or a board. Drag a card to move its stage." />
      {error ? (
        <div className="os-banner">{error}</div>
      ) : (
        <ContactsScreen contacts={data.contacts} setters={data.setters} truncated={data.truncated} initialView={view} now={now} />
      )}
    </>
  );
}
