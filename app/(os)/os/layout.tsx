import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import OsShell from "@/components/os/os-shell";
import { auth } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { PANEL_WIDTH_COOKIE, parsePanelWidth } from "@/lib/os/contact-panel/width";
import { followupsDue } from "@/lib/os/followups-data";
import { osMockEnabled } from "@/lib/os/mock";
import { parseSidebarCookie, SIDEBAR_COOKIE, type NavItem } from "@/lib/os/nav";
import { capState } from "@/lib/os/sending/cap";
import { requestPendingDrafts } from "@/lib/os/inbox";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import "./os.css";
import "./inbox.css";
import "./knowledge.css";
import "./integrations.css";
import "./automations.css";
import "./settings.css";
import "./contacts.css";
import "./followups.css";
import "./voice.css";
import "./sequences.css";
// Wave-0 stream files (empty until their stream fills them).
import "./panel.css";
import "./thread.css";
import "./fields.css";
import "./broadcasts.css";
import "./home.css";
import "./palette.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = { title: "DM OS" };

/** Sidebar counts. Cheap reads only; a failure just hides the number. */
async function navCounts(workspaceId: string): Promise<Partial<Record<NavItem["key"], number>>> {
  const [drafts, followups] = await Promise.all([
    requestPendingDrafts(workspaceId).then((d) => d.length).catch(() => 0),
    followupsDue(workspaceId).catch(() => 0),
  ]);
  return { inbox: drafts, followups };
}

/** Sidebar foot: today's sends against the cap, and Pause all. */
async function sendsToday(workspaceId: string) {
  try {
    const s = await capState(workspaceId);
    return { sentToday: s.sentToday, cap: s.cap, pausedAll: s.pausedAll };
  } catch {
    return { sentToday: 0, cap: 80, pausedAll: false };
  }
}

export default async function OsLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login?callbackUrl=/os");

  const workspace = await ensureWorkspaceForUser(session.user.id, session.user.email);
  const [account, counts, sends, cookieStore] = await Promise.all([
    prisma.instagramAccount.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { connectedAt: "desc" },
      select: { username: true },
    }),
    navCounts(workspace.id),
    sendsToday(workspace.id),
    cookies(),
  ]);
  const sidebar = parseSidebarCookie(cookieStore.get(SIDEBAR_COOKIE)?.value);
  const panelWidth = parsePanelWidth(cookieStore.get(PANEL_WIDTH_COOKIE)?.value);

  return (
    <div className={`os ${inter.variable}`} style={{ "--os-panel-w": `${panelWidth}px` } as React.CSSProperties}>
      <OsShell workspaceName={workspace.name} instagramUsername={account?.username ?? (osMockEnabled() ? "claudepreneur" : null)} counts={counts} sends={sends} sidebar={sidebar}>
        {children}
      </OsShell>
    </div>
  );
}
