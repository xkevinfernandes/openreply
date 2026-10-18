import Link from "next/link";
import { Suspense } from "react";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import { PageHead } from "@/components/os/page-head";
import DiagnosticsPanel from "@/components/os/settings/diagnostics-panel";
import { DisconnectButton, ZernioPanel } from "@/components/os/settings/instagram-panel";
import LogsPanel from "@/components/os/settings/logs-panel";
import WorkspacePanel from "@/components/os/settings/workspace-panel";
import { prisma } from "@/lib/db/client";
import { accountProblems } from "@/lib/os/automations";
import { parseSettingsTab, SETTINGS_TABS } from "@/lib/os/settings";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

type PageProps = { searchParams: Promise<{ tab?: string }> };

async function InstagramTab({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [accounts, zernio] = await Promise.all([
    prisma.instagramAccount.findMany({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: {
        id: true,
        username: true,
        name: true,
        provider: true,
        tokenExpiresAt: true,
        webhookSubscribed: true,
        zernioAccountId: true,
        connectedAt: true,
        _count: { select: { automations: true } },
      },
    }),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } }),
  ]);
  const now = new Date();
  const ws = { zernioReady: Boolean(zernio?.webhookId), kitConnected: true };

  return (
    <div className="os-set-stack">
      <Suspense fallback={null}>
        <div className="os-upstream">
          <InstagramConnectNotice />
        </div>
      </Suspense>

      <section className="os-set-section" aria-labelledby="os-set-accounts">
        <header className="os-set-section-head">
          <h2 id="os-set-accounts">Instagram accounts</h2>
          <p>The accounts your automations send from and J reads. Comments, DMs and replies all go through this connection.</p>
        </header>
        {!accounts.length ? (
          <p className="os-set-empty">No account connected yet. Add your Zernio key below, then pick the Instagram account.</p>
        ) : (
          <ul className="os-set-list">
            {accounts.map((a) => {
              const problems = accountProblems(a, ws, now);
              return (
                <li key={a.id} className="os-set-item">
                  <div className="os-set-item-text">
                    <strong>
                      <a href={`https://instagram.com/${a.username}`} target="_blank" rel="noreferrer">
                        @{a.username}
                      </a>
                    </strong>
                    <span>
                      {a.provider === "ZERNIO" ? "Through Zernio" : "Own Meta app"} · {a._count.automations} automation
                      {a._count.automations === 1 ? "" : "s"} · connected{" "}
                      {a.connectedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                  </div>
                  <span className="os-st" data-tone={problems.length ? "bad" : "good"}>
                    <i />
                    {problems[0] ?? "Connected"}
                  </span>
                  {canManage && <DisconnectButton id={a.id} username={a.username} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <ZernioPanel canManage={canManage} />
    </div>
  );
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return null;
  const tab = parseSettingsTab((await searchParams).tab);
  const canManage = canManageWorkspace(context.role);

  return (
    <>
      <PageHead title="Settings" description="Your Instagram connection, every DM the automations sent, and whether the sending pipeline is healthy." />
      <nav className="os-kb-tabs os-set-tabs" aria-label="Settings sections">
        {SETTINGS_TABS.map((t) => (
          <Link key={t.tab} href={t.tab === "instagram" ? "/os/settings" : `/os/settings?tab=${t.tab}`} aria-current={tab === t.tab ? "page" : undefined}>
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "instagram" && <InstagramTab workspaceId={context.workspaceId} canManage={canManage} />}
      {tab === "logs" && <LogsPanel />}
      {tab === "diagnostics" && <DiagnosticsPanel />}
      {tab === "workspace" && <WorkspacePanel workspaceName={context.workspace.name} />}
    </>
  );
}
