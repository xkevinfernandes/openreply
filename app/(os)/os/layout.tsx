import { Inter } from "next/font/google";
import { redirect } from "next/navigation";
import OsShell from "@/components/os/os-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { followupsDue } from "@/lib/os/followups-data";
import { pendingDrafts } from "@/lib/os/setter/service";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import "./os.css";
import "./inbox.css";
import "./knowledge.css";
import "./integrations.css";
import "./automations.css";
import "./settings.css";
import "./contacts.css";
import "./followups.css";
import "./experiments.css";
import "./voice.css";
import "./sequences.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = { title: "DM OS" };

/** Sidebar counts. Cheap reads only; a failure just hides the number. */
async function navCounts(workspaceId: string): Promise<Record<string, number>> {
  const [drafts, contacts, setters, followups] = await Promise.all([
    pendingDrafts(workspaceId).then((d) => d.length).catch(() => 0),
    prisma.contact.count({ where: { workspaceId } }).catch(() => 0),
    prisma.setter.count({ where: { workspaceId } }).catch(() => 0),
    followupsDue(workspaceId).catch(() => 0),
  ]);
  return { "/os/inbox": drafts, "/os/contacts": contacts, "/os/knowledge": setters, "/os/follow-ups": followups };
}

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/os");

  const workspace = await ensureWorkspaceForUser(session.user.id, session.user.email);
  const [account, counts] = await Promise.all([
    prisma.instagramAccount.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { connectedAt: "desc" },
      select: { username: true },
    }),
    navCounts(workspace.id),
  ]);

  return (
    <div className={`os ${inter.variable}`}>
      <OsShell workspaceName={workspace.name} instagramUsername={account?.username ?? null} counts={counts}>
        {children}
      </OsShell>
    </div>
  );
}
