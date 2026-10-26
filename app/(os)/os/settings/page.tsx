import Link from "next/link";
import { Suspense } from "react";
import { InstagramConnectNotice } from "@/components/instagram-connect-notice";
import SettingsIntegrations from "@/components/os/integrations/settings-board";
import DiagnosticsPanel from "@/components/os/settings/diagnostics-panel";
import FieldsPanel from "@/components/os/settings/fields-panel";
import { DisconnectButton, ReconnectBar, ZernioPanel } from "@/components/os/settings/instagram-panel";
import LogsPanel from "@/components/os/settings/logs-panel";
import SendingPanel from "@/components/os/settings/sending-panel";
import SettingsNav from "@/components/os/settings/settings-nav";
import TagsPanel from "@/components/os/settings/tags-panel";
import WorkspacePanel from "@/components/os/settings/workspace-panel";
import { prisma } from "@/lib/db/client";
import { accountProblems } from "@/lib/os/automations";
import { listCustomFields } from "@/lib/os/fields/store";
import { calendarBoard } from "@/lib/os/integrations/calendar/view";
import { dataOsView } from "@/lib/os/integrations/dataos";
import { isNativeFieldKey } from "@/lib/os/integrations/mapping";
import { integrationsView } from "@/lib/os/integrations/view";
import { osMockEnabled } from "@/lib/os/mock";
import { parseSettingsTab, reconnectKind, SETTINGS_TABS, settingsHref } from "@/lib/os/settings";
import { statusLines } from "@/lib/os/settings-status";
import { loadTagBoard } from "@/lib/os/tags/board";
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
  const first = accounts[0] ?? null;
  const problems = first ? accountProblems(first, ws, now) : [];
  const fix = reconnectKind(problems);

  return (
    <div className="os-set-stack">
      {fix && canManage ? <ReconnectBar problem={problems[0]} kind={fix} /> : null}
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
  const [views, calendars, dataos, account, ws, fields, tags, zernio, zernioFull] = await Promise.all([
    integrationsView(workspaceId),
    calendarBoard(workspaceId),
    dataOsView(workspaceId),
    prisma.instagramAccount.findFirst({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { id: true, username: true, provider: true, tokenExpiresAt: true, webhookSubscribed: true, zernioAccountId: true, _count: { select: { automations: true } } },
    }),
    getWorkspaceSettings(workspaceId),
    listCustomFields(workspaceId),
    kitTags(workspaceId).catch(() => []),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } }),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { workspaceId: true } }),
  ]);
  const problem = account ? (accountProblems(account, { zernioReady: Boolean(zernio?.webhookId), kitConnected: true }, new Date())[0] ?? null) : null;
  const mock = !account && osMockEnabled();
  return (
    <SettingsIntegrations
      instagram={{ id: account?.id ?? null, username: account?.username ?? (mock ? "claudepreneur" : null), provider: account?.provider ?? (mock ? "ZERNIO" : null), problem, sendCap: ws.sendCapPerDay }}
      zernio={mock ? { configured: true, webhookReady: true } : { configured: Boolean(zernioFull), webhookReady: Boolean(zernio?.webhookId) }}
      dataos={dataos}
      views={views}
      calendars={calendars}
      mapped={{ ghl: fields.filter((f) => f.ghlField && !isNativeFieldKey(f.key)).length, kit: fields.filter((f) => f.kitField && !isNativeFieldKey(f.key)).length }}
      fields={fields}
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

async function TagsTab({ workspaceId, canManage }: { workspaceId: string; canManage: boolean }) {
  return <TagsPanel board={await loadTagBoard(workspaceId)} canManage={canManage} />;
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
  const raw = (await searchParams).tab;
  const tab = parseSettingsTab(raw);
  const canManage = canManageWorkspace(context.role);
  const ws = context.workspaceId;
  const lines = await statusLines(ws);
  const label = SETTINGS_TABS.find((t) => t.tab === tab)?.label ?? "Settings";

  return (
    <div className="os-sx">
      <h1 className="os-sx-title os-title">Settings</h1>
      {/* Phone: /os/settings is the list; a row (?tab=) opens its section. */}
      <div className="os-sx-layout" data-view={raw ? "section" : "list"}>
        <SettingsNav items={SETTINGS_TABS.map((t) => ({ tab: t.tab, label: t.label, href: settingsHref(t.tab), line: lines[t.tab] }))} current={tab} />
        <div className="os-sx-body" data-tab={tab}>
          <Link href="/os/settings" className="os-sx-back">
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M10 3.5 5.5 8l4.5 4.5" />
            </svg>
            Settings
          </Link>
          <h2 className="os-sx-section-title">{label}</h2>
          {tab === "instagram" && <InstagramTab workspaceId={ws} canManage={canManage} />}
          {tab === "integrations" && <IntegrationsTab workspaceId={ws} canManage={canManage} />}
          {tab === "fields" && <FieldsTab workspaceId={ws} canManage={canManage} />}
          {tab === "tags" && <TagsTab workspaceId={ws} canManage={canManage} />}
          {tab === "logs" && <LogsPanel />}
          {tab === "diagnostics" && <DiagnosticsPanel />}
          {tab === "workspace" && <WorkspaceTab workspaceId={ws} workspaceName={context.workspace.name} canManage={canManage} />}
        </div>
      </div>
    </div>
  );
}
