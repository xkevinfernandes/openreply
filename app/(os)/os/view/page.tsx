// View-only inboxes: other people's DMs Kevin can see but never act on
// (lib/os/view-inbox.ts). A list; each opens at /os/view/[id].

import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHead } from "@/components/os/page-head";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { listViewInboxes } from "@/lib/os/view-inbox";
import "./view.css";

export const dynamic = "force-dynamic";

export default async function ViewInboxesPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) redirect("/login?callbackUrl=/os/view");
  const inboxes = await listViewInboxes(workspaceId);

  return (
    <div className="os-view">
      <PageHead title="View only" description="Clients' DMs you can read. Nothing here can send, reply or run an automation." />
      {inboxes.length === 0 ? (
        <p className="os-view-empty">No view-only inboxes yet.</p>
      ) : (
        <ul className="os-view-inboxes">
          {inboxes.map((i) => (
            <li key={i.id}>
              <Link href={`/os/view/${i.id}`}>
                <strong>{i.label}</strong> <span>@{i.username}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
