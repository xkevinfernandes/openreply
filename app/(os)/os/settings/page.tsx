import Link from "next/link";
import { Suspense } from "react";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import SettingsIntegrations from "@/components/os/integrations/settings-board";
import DiagnosticsPanel from "@/components/os/settings/diagnostics-panel";
import FieldsPanel from "@/components/os/settings/fields-panel";
import { DisconnectButton, ZernioPanel } from "@/components/os/settings/instagram-panel";
import LogsPanel from "@/components/os/settings/logs-panel";
import SendingPanel from "@/components/os/settings/sending-panel";
import WorkspacePanel from "@/components/os/settings/workspace-panel";
import { ScrollPicked } from "@/components/os/ui/scroll-picked";
import { prisma } from "@/lib/db/client";
import { accountProblems } from "@/lib/os/automations";
import { listCustomFields } from "@/lib/os/fields/store";
import { calendarBoard } from "@/lib/os/integrations/calendar/view";
import { dataOsView } from "@/lib/os/integrations/dataos";
import { integrationsView } from "@/lib/os/integrations/view";
import { osMockEnabled } from "@/lib/os/mock";
import { parseSettingsTab, SETTINGS_TABS, settingsHref } from "@/lib/os/settings";
import { getWorkspaceSettings } from "@/lib/os/workspace-settings";
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

/** The most used tags we pushed to Kit (the Kit row's sub line). */
async function kitTags(workspaceId: string): Promise<string[]> {
  const rows = await prisma.contactSync.findMany({ where: { workspaceId, provider: "kit", lastSyncedAt: { not: null } }, select: { pushedTags: true }, take: 500 });
  const counts = new Map<string, number>();
  for (const r of rows) for (const t of r.pushedTags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([t]) => t);
}

async function IntegrationsTab({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [views, calendars, dataos, account, ws, fields, tags, zernio] = await Promise.all([
    integrationsView(workspaceId),
    calendarBoard(workspaceId),
    dataOsView(workspaceId),
    prisma.instagramAccount.findFirst({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { username: true, provider: true, tokenExpiresAt: true, webhookSubscribed: true, zernioAccountId: true, _count: { select: { automations: true } } },
    }),
    getWorkspaceSettings(workspaceId),
    listCustomFields(workspaceId),
    kitTags(workspaceId).catch(() => []),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } }),
  ]);
  const problem = account ? (accountProblems(account, { zernioReady: Boolean(zernio?.webhookId), kitConnected: true }, new Date())[0] ?? null) : null;
  const mock = !account && osMockEnabled();
  return (
    <SettingsIntegrations
      instagram={{ username: account?.username ?? (mock ? "claudepreneur" : null), provider: account?.provider ?? (mock ? "ZERNIO" : null), problem, sendCap: ws.sendCapPerDay }}
      dataos={dataos}
      views={views}
      calendars={calendars}
      mapped={{ ghl: fields.filter((f) => f.ghlField).length, kit: fields.filter((f) => f.kitField).length }}
      kitTags={tags}
      canManage={canManage}
      now={Date.now()}
    />
  );
}

async function FieldsTab({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  const [fields, setters] = await Promise.all([
    listCustomFields(workspaceId),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] }),
  ]);
  return <FieldsPanel fields={fields} setters={setters} canManage={canManage} />;
}

async function WorkspaceTab({ workspaceId, workspaceName, canManage }: { workspaceId: string; workspaceName: string; canManage: boolean }) {
  const ws = await getWorkspaceSettings(workspaceId);
  return (
    <div className="os-set-stack">
      <SendingPanel sendCap={ws.sendCapPerDay} timezone={ws.timezone} canManage={canManage} />
      <WorkspacePanel workspaceName={workspaceName} />
    </div>
  );
}

export default async function SettingsPage({ searchParams }: PageProps) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return null;
  const tab = parseSettingsTab((await searchParams).tab);
  const canManage = canManageWorkspace(context.role);
  const ws = context.workspaceId;

  return (
    <div className="os-sx">
      <h1 className="os-sx-title os-title">Settings</h1>
      <div className="os-sx-layout">
        <nav className="os-sx-nav" aria-label="Settings sections">
          {SETTINGS_TABS.map((t) => (
            <Link key={t.tab} href={settingsHref(t.tab)} aria-current={tab === t.tab ? "page" : undefined}>
              {t.label}
            </Link>
          ))}
        </nav>
        <ScrollPicked row=".os-sx-nav" pick={tab} />
        <div className="os-sx-body" data-tab={tab}>
          {tab === "instagram" && <InstagramTab workspaceId={ws} canManage={canManage} />}
          {tab === "integrations" && <IntegrationsTab workspaceId={ws} canManage={canManage} />}
          {tab === "fields" && <FieldsTab workspaceId={ws} canManage={canManage} />}
          {tab === "logs" && <LogsPanel />}
          {tab === "diagnostics" && <DiagnosticsPanel />}
          {tab === "workspace" && <WorkspaceTab workspaceId={ws} workspaceName={context.workspace.name} canManage={canManage} />}
        </div>
      </div>
    </div>
  );
}
