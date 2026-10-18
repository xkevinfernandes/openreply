// Automations: loading the campaign list for /os/automations. Reads the same
// tables and analytics helpers as OpenReply's GET /api/automations, plus our
// CampaignSetter / Setter tables for "which setter answers".

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { calculateCtr, CLICK_ROW_SELECT, countUniqueClicksBy } from "@/lib/tracking/analytics";
import { actionNeeded, RECENT_FAILURE_DAYS, type AutomationRow, type TriggerShape, type WorkspaceHealth } from "@/lib/os/automations";

interface SetterLite {
  id: string;
  name: string;
  isDefault: boolean;
  instagramAccountId: string | null;
  createdAt: Date;
}

/** Spec item 13 without a contact: the campaign override, else the account default, else the workspace default. */
export function setterForCampaign(
  automationId: string,
  instagramAccountId: string,
  overrides: Map<string, string>,
  setters: SetterLite[]
): AutomationRow["setter"] {
  const byId = new Map(setters.map((s) => [s.id, s]));
  const override = overrides.get(automationId);
  const own = override ? byId.get(override) : undefined;
  if (own) return { id: own.id, name: own.name, viaCampaign: true };
  const oldestFirst = [...setters].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const fallback =
    oldestFirst.find((s) => s.isDefault && s.instagramAccountId === instagramAccountId) ??
    oldestFirst.find((s) => s.isDefault) ??
    oldestFirst[0];
  return fallback ? { id: fallback.id, name: fallback.name, viaCampaign: false } : null;
}

export async function listAutomationRows(workspaceId: string, now = new Date()): Promise<{ rows: AutomationRow[]; sample: boolean }> {
  const since = new Date(now.getTime() - RECENT_FAILURE_DAYS * 86400_000);
  const [automations, statusCounts, recentFailed, clickRows, setters, overrides, zernio, kit] = await Promise.all([
    prisma.automation.findMany({
      where: { workspaceId },
      include: {
        instagramAccount: {
          select: { username: true, provider: true, tokenExpiresAt: true, webhookSubscribed: true, zernioAccountId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dmLog.groupBy({ by: ["automationId", "status"], where: { workspaceId }, _count: { _all: true } }),
    prisma.dmLog.groupBy({
      by: ["automationId"],
      where: { workspaceId, status: "FAILED", createdAt: { gte: since } },
      _count: { _all: true },
    }),
    prisma.linkClick.findMany({ where: { workspaceId }, select: CLICK_ROW_SELECT }),
    prisma.setter.findMany({
      where: { workspaceId },
      select: { id: true, name: true, isDefault: true, instagramAccountId: true, createdAt: true },
    }),
    prisma.campaignSetter.findMany({ where: { workspaceId }, select: { automationId: true, setterId: true } }),
    prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } }),
    prisma.crmConnection.findFirst({ where: { workspaceId, provider: "KIT" }, select: { id: true } }),
  ]);

  if (!automations.length && osMockEnabled()) return { rows: sampleRows(now), sample: true };

  const ws: WorkspaceHealth = { zernioReady: Boolean(zernio?.webhookId), kitConnected: Boolean(kit) };
  const overrideMap = new Map(overrides.map((o) => [o.automationId, o.setterId]));
  const failedRecent = new Map(recentFailed.map((r) => [r.automationId, r._count._all]));
  const clicks = countUniqueClicksBy(clickRows, (r) => r.automationId);
  const counts = new Map<string, { runs: number; sent: number; failed: number }>();
  for (const row of statusCounts) {
    const c = counts.get(row.automationId) ?? { runs: 0, sent: 0, failed: 0 };
    c.runs += row._count._all;
    if (row.status === "SENT") c.sent += row._count._all;
    if (row.status === "FAILED") c.failed += row._count._all;
    counts.set(row.automationId, c);
  }

  const shapes: TriggerShape[] = automations.map((a) => ({
    id: a.id,
    name: a.name,
    instagramAccountId: a.instagramAccountId,
    isActive: a.isActive,
    keywords: a.keywords,
    matchAnyWord: a.matchAnyWord,
    postId: a.postId,
    matchAnyPost: a.matchAnyPost,
    pendingNextReel: a.pendingNextReel,
    dmTriggerEnabled: a.dmTriggerEnabled,
  }));

  const rows = automations.map((a, i): AutomationRow => {
    const c = counts.get(a.id) ?? { runs: 0, sent: 0, failed: 0 };
    const clickCount = clicks.get(a.id) ?? 0;
    const acc = a.instagramAccount;
    return {
      ...shapes[i],
      username: acc?.username ?? null,
      postUrl: a.postUrl,
      opener: (a.openingDmEnabled && a.openingDmMessage?.trim()) || a.dmMessage,
      requireEmail: a.requireEmail,
      requireFollow: a.requireFollow,
      setter: setterForCampaign(a.id, a.instagramAccountId, overrideMap, setters),
      runs: c.runs,
      sent: c.sent,
      failed: c.failed,
      clicks: clickCount,
      ctr: calculateCtr(clickCount, c.sent),
      actions: actionNeeded(
        {
          ...shapes[i],
          requireEmail: a.requireEmail,
          recentFailures: failedRecent.get(a.id) ?? 0,
          account: acc
            ? { provider: acc.provider, tokenExpiresAt: acc.tokenExpiresAt, webhookSubscribed: acc.webhookSubscribed, zernioAccountId: acc.zernioAccountId }
            : null,
        },
        shapes,
        ws,
        now
      ),
      createdAt: a.createdAt.toISOString(),
    };
  });
  return { rows, sample: false };
}

/** Setters for the "Answered by" picker on the edit page. */
export async function campaignSetterChoice(workspaceId: string, automationId: string) {
  const [setters, override, automation] = await Promise.all([
    prisma.setter.findMany({
      where: { workspaceId },
      select: { id: true, name: true, isDefault: true, instagramAccountId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.campaignSetter.findUnique({ where: { automationId }, select: { setterId: true, workspaceId: true } }),
    prisma.automation.findFirst({ where: { id: automationId, workspaceId }, select: { instagramAccountId: true } }),
  ]);
  if (!automation) return null;
  const overrides = new Map<string, string>();
  if (override && override.workspaceId === workspaceId) overrides.set(automationId, override.setterId);
  const fallback = setterForCampaign(automationId, automation.instagramAccountId, new Map(), setters);
  return {
    setters: setters.map((s) => ({ id: s.id, name: s.name })),
    selected: overrides.get(automationId) ?? null,
    defaultName: fallback?.name ?? null,
  };
}

// ---------------------------------------------------------------- OS_MOCK
function sampleRows(now: Date): AutomationRow[] {
  const day = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
  const base = {
    instagramAccountId: "acc1",
    username: "claudepreneur",
    postUrl: null,
    matchAnyPost: false,
    pendingNextReel: false,
    dmTriggerEnabled: false,
    matchAnyWord: false,
    requireFollow: false,
    requireEmail: false,
  };
  return [
    {
      ...base,
      id: "sample-1",
      name: "AI setter reel",
      postId: "p1",
      keywords: ["setter", "SETTER"],
      opener: "hey! here's the setter prompt 👇 want the full walkthrough too?",
      requireEmail: true,
      isActive: true,
      setter: { id: "s1", name: "Claudepreneur", viaCampaign: false },
      runs: 412,
      sent: 398,
      failed: 4,
      clicks: 171,
      ctr: 43,
      actions: ["4 DMs failed in the last 7 days"],
      createdAt: day(2),
    },
    {
      ...base,
      id: "sample-2",
      name: "Workshop keyword",
      postId: null,
      dmTriggerEnabled: true,
      matchAnyPost: true,
      keywords: ["workshop"],
      opener: "yo! the workshop replay is here",
      isActive: true,
      setter: { id: "s2", name: "Workshop setter", viaCampaign: true },
      runs: 96,
      sent: 96,
      failed: 0,
      clicks: 51,
      ctr: 53.1,
      actions: [],
      createdAt: day(9),
    },
    {
      ...base,
      id: "sample-3",
      name: "Notion template",
      postId: "p3",
      keywords: ["notion", "template"],
      opener: "sending the template now, follow so you catch the next one",
      requireFollow: true,
      isActive: false,
      setter: { id: "s1", name: "Claudepreneur", viaCampaign: false },
      runs: 1203,
      sent: 1180,
      failed: 11,
      clicks: 402,
      ctr: 34.1,
      actions: [],
      createdAt: day(40),
    },
  ];
}
