// The status line under each Settings section ("@claudepreneur · connected",
// "3 built in · 7 custom"…). Each one reads on its own; the page caps them
// at 1.5 s and fills the slow ones client-side from /api/os/settings-status.

import { prisma } from "@/lib/db/client";
import { accountProblems } from "@/lib/os/automations";
import { diagnosticsSummary } from "@/lib/os/diagnostics";
import { readChecks } from "@/lib/os/diagnostics-reads";
import { listCustomFields } from "@/lib/os/fields/store";
import { calendarBoard } from "@/lib/os/integrations/calendar/view";
import { dataOsView } from "@/lib/os/integrations/dataos";
import { integrationsView } from "@/lib/os/integrations/view";
import { osMockEnabled } from "@/lib/os/mock";
import {
  diagnosticsStatus,
  fieldsStatus,
  instagramStatus,
  integrationsStatus,
  logsStatus,
  SETTINGS_TABS,
  STATUS_PENDING,
  tagsStatus,
  withCap,
  WORKSPACE_STATUS,
  type SettingsTab,
} from "@/lib/os/settings";
import { listTags } from "@/lib/os/tags/store";

export const STATUS_CAP_MS = 1500;

/** The workspace's newest Instagram account and its problems. */
export async function instagramHealth(workspaceId: string) {
  const [account, zernio] = await Promise.all([
    prisma.instagramAccount.findFirst({
      where: { workspaceId },
      orderBy: { connectedAt: "desc" },
      select: { id: true, username: true, provider: true, tokenExpiresAt: true, webhookSubscribed: true, zernioAccountId: true },
    }),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true, profileId: true } }),
  ]);
  const problems = account ? accountProblems(account, { zernioReady: Boolean(zernio?.webhookId), kitConnected: true }, new Date()) : [];
  return { account, zernio, problems };
}

const LOADERS: Record<SettingsTab, (workspaceId: string) => Promise<string>> = {
  async instagram(ws) {
    const { account, problems } = await instagramHealth(ws);
    if (!account && osMockEnabled()) return instagramStatus({ username: "claudepreneur", problem: null });
    return instagramStatus({ username: account?.username ?? null, problem: problems[0] ?? null });
  },
  async integrations(ws) {
    const [zernio, views, calendars, dataos] = await Promise.all([
      prisma.zernioConnection.findUnique({ where: { workspaceId: ws }, select: { workspaceId: true } }),
      integrationsView(ws),
      calendarBoard(ws),
      dataOsView(ws),
    ]);
    const names: string[] = [];
    // OS_MOCK shows Zernio as connected in Integrations (no key needed).
    if (zernio || osMockEnabled()) names.push("Zernio");
    if (views.find((v) => v.provider === "kit")?.connected) names.push("Kit");
    for (const c of calendars.calendars) if (c.connected) names.push(c.provider === "calcom" ? "Cal.com" : "Calendly");
    if (views.find((v) => v.provider === "ghl")?.connected) names.push("GoHighLevel");
    if (dataos.connected) names.push("Data OS");
    return integrationsStatus(names);
  },
  async fields(ws) {
    const fields = await listCustomFields(ws);
    // The Instagram handle is built in too (it isn't a CustomField row).
    // Name and Email show as built in even before their rows exist.
    return fieldsStatus(1 + (fields.filter((f) => f.builtIn).length || 2), fields.filter((f) => !f.builtIn).length);
  },
  async tags(ws) {
    const tags = await listTags(ws);
    return tagsStatus(tags.length, tags.filter((t) => t.system).length);
  },
  async logs(ws) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return logsStatus(await prisma.dmLog.count({ where: { workspaceId: ws, createdAt: { gte: start } } }));
  },
  async diagnostics(ws) {
    return diagnosticsStatus(diagnosticsSummary(await readChecks(ws, ["instagram", "webhook", "queue", "worker", "zernio", "kit", "calcom"])).problems);
  },
  async workspace() {
    return WORKSPACE_STATUS;
  },
};

/** One section's line, uncapped (the client fill). */
export async function statusLine(workspaceId: string, tab: SettingsTab): Promise<string> {
  return LOADERS[tab](workspaceId);
}

/** Every line in parallel, each capped: a slow one is "…". */
export async function statusLines(workspaceId: string, capMs = STATUS_CAP_MS): Promise<Record<SettingsTab, string>> {
  const lines = await Promise.all(SETTINGS_TABS.map((t) => withCap(LOADERS[t.tab](workspaceId), capMs)));
  return Object.fromEntries(SETTINGS_TABS.map((t, i) => [t.tab, lines[i] ?? STATUS_PENDING])) as Record<SettingsTab, string>;
}
