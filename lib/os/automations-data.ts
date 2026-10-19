// Automations: loading the campaign list for /os/automations. Reads the same
// tables and analytics helpers as OpenReply's GET /api/automations, plus our
// CampaignSetter / Setter tables for "which setter answers".

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { calculateCtr, CLICK_ROW_SELECT, countUniqueClicksBy } from "@/lib/tracking/analytics";
import {
  actionNeeded,
  campaignResource,
  campaignStats,
  firstUrl,
  RECENT_FAILURE_DAYS,
  type AutomationRow,
  type TriggerShape,
  type WorkspaceHealth,
} from "@/lib/os/automations";
import { nextRunDate } from "@/lib/os/home";
import { catalogRowFromResource } from "@/lib/os/setter/kb";
import { resolve } from "@/lib/os/setter/resources";

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

  const ids = automations.map((a) => a.id);
  const [mapped, resources, links, experiments, people] = await Promise.all([
    prisma.campaignResource.findMany({ where: { workspaceId, automationId: { in: ids } }, select: { automationId: true, resourceId: true } }),
    prisma.resource.findMany({ where: { workspaceId, kind: "resource" } }),
    prisma.trackedLink.findMany({ where: { workspaceId, automationId: { in: ids } }, select: { automationId: true, destinationUrl: true, position: true, createdAt: true } }),
    prisma.experiment.findMany({ where: { workspaceId, status: "RUNNING", slot: { startsWith: "campaign_opener:" } }, select: { slot: true } }),
    prisma.dmLog.findMany({
      where: { workspaceId, automationId: { in: ids } },
      select: { automationId: true, instagramAccountId: true, commenterId: true },
      distinct: ["automationId", "commenterId"],
      take: 20000,
    }),
  ]);
  const contacts = people.length
    ? await prisma.contact.findMany({
        where: { workspaceId, igUserId: { in: [...new Set(people.map((p) => p.commenterId))] } },
        select: { id: true, instagramAccountId: true, igUserId: true },
      })
    : [];
  const events = contacts.length
    ? await prisma.osEvent.findMany({
        where: { workspaceId, kind: { in: ["conversation_started", "call_booked"] }, contactId: { in: contacts.map((c) => c.id) } },
        select: { contactId: true, kind: true },
      })
    : [];
  const stats = campaignStats(people, contacts, events);
  const abOn = new Set(experiments.map((e) => e.slot.slice("campaign_opener:".length)));
  const mappedMap = new Map(mapped.map((m) => [m.automationId, m.resourceId]));
  const catalog = resources.map(catalogRowFromResource);
  const idBySlug = new Map(resources.map((r) => [r.slug, r.id]));
  const firstLink = new Map<string, string>();
  for (const l of [...links].sort((a, b) => a.position - b.position || a.createdAt.getTime() - b.createdAt.getTime())) {
    if (!firstLink.has(l.automationId)) firstLink.set(l.automationId, l.destinationUrl);
  }

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
    const link = firstLink.get(a.id) ?? firstUrl(a.dmMessage) ?? firstUrl(a.openingDmMessage);
    const hit = resolve([link ?? "", a.dmMessage, a.openingDmMessage ?? ""], catalog)[0];
    const resolvedId = hit ? idBySlug.get(hit.slug) : undefined;
    const st = stats.get(a.id);
    return {
      ...shapes[i],
      resource: campaignResource(a.id, mappedMap, resources, resolvedId ? { id: resolvedId } : null),
      link,
      ab: abOn.has(a.id),
      replied: st?.replied ?? 0,
      booked: st?.booked ?? 0,
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

// ---------------------------------------------------------------- tabs, broadcasts, pickers

export interface BroadcastSummary {
  key: string;
  name: string;
  window: string;
  audience: string;
  status: "needs_link" | "review" | "scheduled" | "done" | "off";
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Pure: a broadcast's state for its next run. */
export function broadcastStatus(
  b: { enabled: boolean; template?: string; windowDay: number; windowEnd: string; timezone: string },
  runs: { runDate: string; status: string }[],
  now: Date
): BroadcastSummary["status"] {
  // Saving this week's link is what starts a run, so a set-up broadcast needs one even while off.
  if (!b.enabled && !b.template?.trim()) return "off";
  const next = nextRunDate(b.windowDay, b.windowEnd, b.timezone, now);
  const run = runs.find((r) => r.runDate === next.date);
  if (!run) return "needs_link";
  return run.status === "done" ? "done" : run.status === "scheduled" ? "scheduled" : "review";
}

/** Read-only list for the Campaigns tab; the builder is S5's /os/automations/broadcasts. */
export async function listBroadcastSummaries(workspaceId: string, now = new Date()): Promise<BroadcastSummary[]> {
  const list = await prisma.broadcast.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "asc" },
    select: { key: true, name: true, audienceTag: true, enabled: true, template: true, windowDay: true, windowStart: true, windowEnd: true, timezone: true, runs: { select: { runDate: true, status: true }, orderBy: { runDate: "desc" }, take: 4 } },
  });
  return list.map((b) => ({
    key: b.key,
    name: b.name,
    window: `${DAYS[b.windowDay] ?? "?"} ${b.windowStart}–${b.windowEnd}`,
    audience: b.audienceTag,
    status: broadcastStatus(b, b.runs, now),
  }));
}

export async function automationTabCounts(workspaceId: string, campaignCount?: number) {
  const [campaigns, broadcasts, tests] = await Promise.all([
    campaignCount ?? prisma.automation.count({ where: { workspaceId } }).then((n) => (n || !osMockEnabled() ? n : sampleRows(new Date()).length)).catch(() => 0),
    prisma.broadcast.count({ where: { workspaceId } }).catch(() => 0),
    prisma.experiment.count({ where: { workspaceId, status: "RUNNING" } }).catch(() => 0),
  ]);
  return { campaigns, broadcasts, tests };
}

/** Lead magnets for the keyword → resource picker on the edit page. */
export async function campaignResourceChoice(workspaceId: string, automationId: string) {
  const [resources, row] = await Promise.all([
    prisma.resource.findMany({ where: { workspaceId, kind: "resource" }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    prisma.campaignResource.findUnique({ where: { automationId }, select: { resourceId: true, workspaceId: true } }),
  ]);
  return { resources, selected: row && row.workspaceId === workspaceId ? row.resourceId : null };
}

// ---------------------------------------------------------------- OS_MOCK
/** The AutomationsA board's three campaigns. */
function sampleRows(now: Date): AutomationRow[] {
  const day = (d: number) => new Date(now.getTime() - d * 86400_000).toISOString();
  const base = {
    instagramAccountId: "acc1",
    username: "claudepreneur",
    matchAnyPost: false,
    pendingNextReel: false,
    dmTriggerEnabled: false,
    matchAnyWord: false,
    requireFollow: false,
    requireEmail: false,
    failed: 0,
    clicks: 0,
    ctr: 0,
    actions: [] as string[],
  };
  const j = { id: "s-j", name: "J", viaCampaign: false };
  const nova = { id: "s-nova", name: "Nova", viaCampaign: true };
  const starter = { id: "r-starter", name: "Claude Code Setter Starter", viaLink: false };
  return [
    {
      ...base,
      id: "sample-1",
      name: "AI setter demo",
      postId: "p1",
      postUrl: "https://www.instagram.com/reel/sample1/",
      keywords: ["SETTER"],
      opener: "here you go, the starter I use for my own DMs",
      resource: starter,
      link: "https://claudepreneur.com/starter",
      ab: true,
      isActive: true,
      setter: j,
      runs: 64,
      sent: 64,
      replied: 27,
      booked: 3,
      createdAt: day(2),
    },
    {
      ...base,
      id: "sample-2",
      name: "DM scripts",
      postId: null,
      postUrl: null,
      dmTriggerEnabled: true,
      keywords: ["SCRIPT"],
      opener: "sending the vault now, steal what works",
      resource: { id: "r-vault", name: "DM Script Vault", viaLink: false },
      link: "https://claudepreneur.com/vault",
      ab: false,
      isActive: true,
      setter: j,
      runs: 38,
      sent: 38,
      replied: 15,
      booked: 1,
      createdAt: day(9),
    },
    {
      ...base,
      id: "sample-3",
      name: "setter in 5 steps",
      postId: "p3",
      postUrl: "https://www.instagram.com/p/sample3/",
      keywords: ["STARTER"],
      opener: "here it is, the exact starter from the carousel",
      resource: starter,
      link: "https://claudepreneur.com/starter",
      ab: false,
      isActive: false,
      setter: nova,
      runs: 12,
      sent: 12,
      replied: 4,
      booked: 0,
      createdAt: day(40),
    },
  ];
}
