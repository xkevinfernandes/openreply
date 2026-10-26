// Home's funnel card, its inbox counts and the Pipeline "All · funnel" board
// (dm-crm issues 031/032). The counting is lib/os/crm-funnel.ts (funnelView,
// funnelBoard); this module reads once for the widest window (90 days) and
// shapes all three windows, so the 7/30/90 switch is instant and Home and
// the All board read the same numbers.

import {
  boardColumn,
  FUNNEL_WINDOWS,
  funnelBoard,
  funnelView,
  loadFunnelContacts,
  type FunnelContact,
  type FunnelWindow,
} from "@/lib/os/crm-funnel";

import type { AllBoardData, BoardCard, BoardColumnView, FunnelViews, HomeFunnelData, InboxCounts } from "@/lib/os/home-funnel-view";
import { shortAge } from "@/lib/os/home-funnel-view";

export * from "@/lib/os/home-funnel-view";

const DAY = 86_400_000;
const HOUR = 3_600_000;

// --- Inbox counts ----------------------------------------------------------------

/** What the inbox counts need about one contact (the foundation's columns). */
export interface InboxCountContact {
  id: string;
  kind: string;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  lastOpenedAt: Date | null;
  spam: boolean;
  spamOverride: boolean | null;
  archivedAt: Date | null;
}

/** Hours before the 24-hour window ends that a thread counts as closing. */
export const WINDOW_CLOSING_HOURS = 4;

const hidden = (c: InboxCountContact) => (c.spamOverride ?? c.spam) || Boolean(c.archivedAt);

/** Unread: last inbound later than last opened, or never opened. */
export function isUnread(c: InboxCountContact): boolean {
  return !!c.lastInboundAt && (!c.lastOpenedAt || c.lastInboundAt > c.lastOpenedAt);
}

/** They wrote last and their 24-hour window ends within 4 hours (still open). */
export function isWindowClosing(c: InboxCountContact, now: Date): boolean {
  if (!c.lastInboundAt) return false;
  if (c.lastOutboundAt && c.lastOutboundAt >= c.lastInboundAt) return false;
  const left = c.lastInboundAt.getTime() + 24 * HOUR - now.getTime();
  return left > 0 && left <= WINDOW_CLOSING_HOURS * HOUR;
}

/** Pure: Home's inbox tile. Spam and archived never count (issues 011, 012). */
export function inboxCounts(contacts: InboxCountContact[], draftContactIds: string[], now: Date): InboxCounts {
  const shown = contacts.filter((c) => !hidden(c));
  const hiddenIds = new Set(contacts.filter(hidden).map((c) => c.id));
  return {
    unread: shown.filter(isUnread).length,
    draftsWaiting: new Set(draftContactIds.filter((id) => !hiddenIds.has(id))).size,
    windowClosing: shown.filter((c) => isWindowClosing(c, now)).length,
  };
}

// --- Funnel shapes -----------------------------------------------------------------

/** Pure: Home's funnel for each window from one read. */
export function funnelViews(contacts: FunnelContact[], now: Date): FunnelViews {
  return Object.fromEntries(FUNNEL_WINDOWS.map((w) => [w, funnelView(contacts, w, now)])) as FunnelViews;
}

// --- The All board ------------------------------------------------------------------

/** Pure: the board for each window; cards keyed by id. */
export function allBoardData(contacts: FunnelContact[], info: Map<string, { name: string; setter: string; lastAt: Date | null }>, now: Date): AllBoardData {
  const windows = Object.fromEntries(FUNNEL_WINDOWS.map((w) => [w, funnelBoard(contacts, w, now, { showArchived: true }).columns])) as Record<FunnelWindow, BoardColumnView[]>;
  const shown = new Set(Object.values(windows).flatMap((cols) => cols.flatMap((c) => c.contactIds)));
  const cards: Record<string, BoardCard> = {};
  for (const c of contacts) {
    if (!shown.has(c.id)) continue;
    const i = info.get(c.id);
    cards[c.id] = {
      id: c.id,
      name: i?.name ?? "Someone",
      setter: i?.setter ?? "J",
      age: shortAge(i?.lastAt ?? c.createdAt, now),
      archived: Boolean(c.archivedAt),
      wonAmount: boardColumn(c) === "won" ? c.wonAmount : null,
    };
  }
  return { windows, cards };
}

// --- Loaders ------------------------------------------------------------------------

/** All the contacts the three windows need (OS_MOCK adds a realistic sample). */
export async function loadWindowContacts(workspaceId: string, now: Date): Promise<FunnelContact[]> {
  const rows = await loadFunnelContacts(workspaceId, 90, now);
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (!osMockEnabled()) return rows;
  const { mockHomeContacts, applyMockFunnelMoves } = await import("@/lib/os/mock-home");
  return applyMockFunnelMoves([...rows, ...mockHomeContacts(now)]);
}

async function contactNames(workspaceId: string, ids: string[]): Promise<Map<string, { name: string; setter: string; lastAt: Date | null }>> {
  const out = new Map<string, { name: string; setter: string; lastAt: Date | null }>();
  if (!ids.length) return out;
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) {
    const { mockThreads } = await import("@/lib/os/mock");
    const { mockHomeInfo } = await import("@/lib/os/mock-home");
    for (const t of mockThreads()) if (t.contact) out.set(t.contact.id, { name: t.username ?? t.fullName ?? "Someone", setter: "J", lastAt: t.updatedTime ? new Date(t.updatedTime) : null });
    for (const [id, v] of mockHomeInfo()) out.set(id, v);
    return out;
  }
  const { prisma } = await import("@/lib/db/client");
  const [rows, setters] = await Promise.all([
    prisma.contact.findMany({ where: { workspaceId, id: { in: ids } }, select: { id: true, username: true, fullName: true, setterId: true, lastInboundAt: true, lastOutboundAt: true } }),
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true, isDefault: true }, orderBy: { createdAt: "asc" } }),
  ]);
  const fallback = setters.find((s) => s.isDefault) ?? setters[0];
  for (const r of rows) {
    const last = [r.lastInboundAt, r.lastOutboundAt].filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    out.set(r.id, { name: r.username ?? r.fullName ?? "Someone", setter: (r.setterId && setters.find((s) => s.id === r.setterId)?.name) || fallback?.name || "J", lastAt: last });
  }
  return out;
}

async function stageLogSince(workspaceId: string, now: Date): Promise<Date> {
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) return new Date(now.getTime() - 4 * DAY);
  const { prisma } = await import("@/lib/db/client");
  const first = await prisma.contactStageLog.findFirst({ where: { workspaceId }, orderBy: { at: "asc" }, select: { at: true } });
  return first?.at ?? now;
}

async function wonEventTimes(workspaceId: string, ids: string[], now: Date): Promise<Map<string, Date>> {
  const out = new Map<string, Date>();
  if (!ids.length) return out;
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) {
    const { mockWonAt } = await import("@/lib/os/mock-home");
    for (const id of ids) out.set(id, mockWonAt(id, now));
    return out;
  }
  const { prisma } = await import("@/lib/db/client");
  const rows = await prisma.osEvent.findMany({ where: { workspaceId, kind: "won", contactId: { in: ids } }, select: { contactId: true, at: true } });
  for (const r of rows) if (r.contactId) out.set(r.contactId, r.at);
  return out;
}

export async function loadHomeFunnel(workspaceId: string, currency: string, now = new Date()): Promise<HomeFunnelData> {
  const contacts = await loadWindowContacts(workspaceId, now);
  const views = funnelViews(contacts, now);
  const ids = [...new Set(FUNNEL_WINDOWS.flatMap((w) => views[w].revenue.noAmount))];
  const [names, times, since] = await Promise.all([contactNames(workspaceId, ids), wonEventTimes(workspaceId, ids, now), stageLogSince(workspaceId, now)]);
  return {
    views,
    currency,
    stageLogSince: since.toISOString(),
    noAmount: ids.map((id) => ({ id, name: names.get(id)?.name ?? "Someone", wonAt: (times.get(id) ?? now).toISOString() })),
  };
}

export async function loadAllBoard(workspaceId: string, now = new Date()): Promise<AllBoardData> {
  const contacts = await loadWindowContacts(workspaceId, now);
  const ids = contacts.map((c) => c.id);
  return allBoardData(contacts, await contactNames(workspaceId, ids), now);
}

export async function loadInboxCounts(workspaceId: string, now = new Date()): Promise<InboxCounts> {
  const { pendingDrafts } = await import("@/lib/os/setter/service");
  const drafts = await pendingDrafts(workspaceId).catch(() => []);
  const draftIds = drafts.map((d) => d.contactId);
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) {
    const { mockInboxContacts } = await import("@/lib/os/mock-home");
    return inboxCounts(mockInboxContacts(now), draftIds, now);
  }
  const { prisma } = await import("@/lib/db/client");
  // Unread compares two columns, which Prisma's filters can't: ids first.
  const unread = await prisma.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Contact"
    WHERE "workspaceId" = ${workspaceId} AND "lastInboundAt" IS NOT NULL
      AND ("lastOpenedAt" IS NULL OR "lastInboundAt" > "lastOpenedAt")`;
  const rows = await prisma.contact.findMany({
    where: {
      workspaceId,
      OR: [{ id: { in: unread.map((u) => u.id) } }, { id: { in: draftIds } }, { lastInboundAt: { gte: new Date(now.getTime() - DAY) } }],
    },
    select: { id: true, kind: true, lastInboundAt: true, lastOutboundAt: true, lastOpenedAt: true, spam: true, spamOverride: true, archivedAt: true },
  });
  return inboxCounts(rows, draftIds, now);
}
