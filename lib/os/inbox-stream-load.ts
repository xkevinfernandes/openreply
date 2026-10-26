// The inbox stream from the local contact table (dm-crm issue 009): every
// contact with a Zernio conversation, newest first by the stored last message
// time. Zernio's list (listThreads: its newest 50) still runs on each load to
// record new threads and move times later; it also gives the preview, the
// picture and Zernio's unread count for the threads it has. Filters, counts
// and paging all run on the local rows (lib/os/inbox-stream.ts).

import { cache } from "react";
import { prisma } from "@/lib/db/client";
import { listThreads, requestPendingDrafts, type InboxThread } from "@/lib/os/inbox";
import { draftsWaitingCount, matchesStatus, sortStream, type StreamThread, type ThreadCrm } from "@/lib/os/inbox-stream";
import type { InboxCounts } from "@/lib/os/home-funnel-view";
import { osMockEnabled } from "@/lib/os/mock";

/** Most rows the stream reads (filters run over all of them). */
export const STREAM_MAX = 2000;

const STREAM_SELECT = {
  id: true,
  igUserId: true,
  username: true,
  fullName: true,
  avatarUrl: true,
  zernioConversationId: true,
  lastMessageAt: true,
  kind: true,
  kindSource: true,
  stage: true,
  entryPath: true,
  setterStage: true,
  paused: true,
  suggestedKind: true,
  suggestedReason: true,
  suggestedConfidence: true,
  suggestedBy: true,
  triagedMessageId: true,
  onFriday: true,
  seenAt: true,
  lastInboundAt: true,
  lastOutboundAt: true,
  lastOpenedAt: true,
  lastPersonalSendAt: true,
  starred: true,
  spam: true,
  spamOverride: true,
  archivedAt: true,
} as const;

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export interface StreamLoad {
  connected: boolean;
  threads: StreamThread[];
}

export async function loadStream(workspaceId: string): Promise<StreamLoad> {
  if (osMockEnabled()) {
    const { mockStream } = await import("@/lib/os/mock-inbox");
    return { connected: true, threads: mockStream() };
  }
  // Sync Zernio's newest 50 first (records contacts, moves times later).
  const { account, threads: zernio } = await listThreads(workspaceId);
  const rows = await prisma.contact.findMany({
    where: { workspaceId, zernioConversationId: { not: null } },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: STREAM_MAX,
    select: STREAM_SELECT,
  });
  const byConversation = new Map(zernio.map((t) => [t.conversationId, t]));
  const threads = rows.map((c): StreamThread => {
    const z: InboxThread | undefined = byConversation.get(c.zernioConversationId!);
    const crm: ThreadCrm = {
      lastInboundAt: iso(c.lastInboundAt),
      lastOutboundAt: iso(c.lastOutboundAt),
      lastOpenedAt: iso(c.lastOpenedAt),
      lastPersonalSendAt: iso(c.lastPersonalSendAt),
      starred: c.starred,
      spam: c.spam,
      spamOverride: c.spamOverride,
      archivedAt: iso(c.archivedAt),
    };
    return {
      conversationId: c.zernioConversationId!,
      igUserId: c.igUserId,
      username: c.username ?? z?.username ?? null,
      fullName: c.fullName ?? z?.fullName ?? null,
      avatarUrl: z?.avatarUrl ?? c.avatarUrl,
      updatedTime: iso(c.lastMessageAt) ?? z?.updatedTime ?? null,
      preview: z?.preview ?? null,
      unreadCount: z?.unreadCount ?? 0,
      profile: z?.profile ?? null,
      contact: {
        id: c.id,
        kind: c.kind,
        kindSource: c.kindSource,
        stage: c.stage,
        entryPath: c.entryPath,
        setterStage: c.setterStage,
        paused: c.paused,
        suggestedKind: c.suggestedKind,
        suggestedReason: c.suggestedReason,
        suggestedConfidence: c.suggestedConfidence,
        suggestedBy: c.suggestedBy,
        triagedMessageId: c.triagedMessageId,
        onFriday: c.onFriday,
        seenAt: c.seenAt,
      },
      crm,
    };
  });
  return { connected: Boolean(account), threads: sortStream(threads) };
}

/** Once per request (the layout's badge and the page). */
export const requestStream = cache((workspaceId: string) => loadStream(workspaceId));

/** The Inbox nav badge: J's drafts waiting, never on spam or archived threads. */
export async function inboxBadgeCount(workspaceId: string): Promise<number> {
  const drafts = await requestPendingDrafts(workspaceId);
  if (!drafts.length) return 0;
  const ids = new Set(drafts.map((d) => d.contactId));
  if (osMockEnabled()) {
    const { mockStream } = await import("@/lib/os/mock-inbox");
    return draftsWaitingCount(mockStream(), { now: Date.now(), draftContactIds: ids });
  }
  // Only the draft contacts: no Zernio call for the badge.
  const hidden = await prisma.contact.count({
    where: { workspaceId, id: { in: [...ids] }, OR: [{ archivedAt: { not: null } }, { spamOverride: true }, { spam: true, spamOverride: null }] },
  });
  return Math.max(0, ids.size - hidden);
}

/** Home's inbox tile: Unread, Drafts waiting and Window closing, counted by
 *  the inbox's own filters (matchesStatus) over the same rows the stream
 *  reads, so each tile's number is what its filter shows. */
export async function homeInboxCounts(workspaceId: string, now = Date.now()): Promise<InboxCounts> {
  const drafts = await requestPendingDrafts(workspaceId).catch(() => []);
  const ctx = { now, draftContactIds: new Set(drafts.map((d) => d.contactId)) };
  const threads = await countThreads(workspaceId, [...ctx.draftContactIds]);
  const n = (f: "unread" | "drafts" | "closing") => threads.filter((t) => matchesStatus(t, f, ctx)).length;
  return { unread: n("unread"), draftsWaiting: n("drafts"), windowClosing: n("closing") };
}

/** The stream's rows, CRM fields only (no Zernio call): the ones a count
 *  can match (an inbound DM, or a draft waiting). */
async function countThreads(workspaceId: string, draftContactIds: string[]): Promise<StreamThread[]> {
  if (osMockEnabled()) {
    const { mockStream } = await import("@/lib/os/mock-inbox");
    return mockStream();
  }
  const rows = await prisma.contact.findMany({
    where: { workspaceId, zernioConversationId: { not: null }, archivedAt: null, OR: [{ lastInboundAt: { not: null } }, { id: { in: draftContactIds } }] },
    orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
    take: STREAM_MAX,
    select: { id: true, kind: true, lastInboundAt: true, lastOutboundAt: true, lastOpenedAt: true, lastPersonalSendAt: true, starred: true, spam: true, spamOverride: true, archivedAt: true, lastMessageAt: true },
  });
  return rows.map((r) => ({
    conversationId: "",
    igUserId: "",
    username: null,
    preview: null,
    updatedTime: iso(r.lastMessageAt),
    contact: { id: r.id, kind: r.kind } as StreamThread["contact"],
    crm: {
      lastInboundAt: iso(r.lastInboundAt),
      lastOutboundAt: iso(r.lastOutboundAt),
      lastOpenedAt: iso(r.lastOpenedAt),
      lastPersonalSendAt: iso(r.lastPersonalSendAt),
      starred: r.starred,
      spam: r.spam,
      spamOverride: r.spamOverride,
      archivedAt: iso(r.archivedAt),
    },
  }));
}

/** The open thread's CRM fields and whether Zernio sends for it (the
 *  human-agent window is Zernio only). Read from the database, so the thread
 *  doesn't wait for Zernio's list. */
export async function loadThreadCrm(workspaceId: string, contactId: string): Promise<{ crm: ThreadCrm; zernio: boolean } | null> {
  if (osMockEnabled()) {
    const { mockCrmState } = await import("@/lib/os/mock-crm");
    return { crm: { ...mockCrmState(contactId) }, zernio: true };
  }
  const c = await prisma.contact.findFirst({
    where: { id: contactId, workspaceId },
    select: { lastInboundAt: true, lastOutboundAt: true, lastOpenedAt: true, lastPersonalSendAt: true, starred: true, spam: true, spamOverride: true, archivedAt: true, instagramAccountId: true },
  });
  if (!c) return null;
  const account = await prisma.instagramAccount.findFirst({ where: { id: c.instagramAccountId }, select: { provider: true } });
  return {
    crm: {
      lastInboundAt: iso(c.lastInboundAt),
      lastOutboundAt: iso(c.lastOutboundAt),
      lastOpenedAt: iso(c.lastOpenedAt),
      lastPersonalSendAt: iso(c.lastPersonalSendAt),
      starred: c.starred,
      spam: c.spam,
      spamOverride: c.spamOverride,
      archivedAt: iso(c.archivedAt),
    },
    zernio: account?.provider === "ZERNIO",
  };
}
