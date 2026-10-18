import type { Contact, InstagramAccount } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import {
  createInstagramContext,
  getConversationMessages,
  getConversations,
  sendDirectMessage,
} from "@/lib/instagram/provider";
import { zernioRequest } from "@/lib/zernio/client";
import { upsertContact } from "@/lib/os/contacts";
import { enqueueTriageMany } from "@/lib/os/setter/queue";
import { triageDisabled } from "@/lib/os/setter/triage";
import { appendMockMessage, mockMessages, mockThreads, osMockEnabled } from "@/lib/os/mock";

/** What Zernio tells us about the person on each list read (not stored). */
export interface InboxProfile {
  isFollower: boolean | null;
  isFollowing: boolean | null;
  followerCount: number | null;
  isVerified: boolean | null;
}

export interface InboxThread {
  conversationId: string;
  igUserId: string;
  username: string | null;
  updatedTime: string | null;
  preview: string | null;
  /** Instagram CDN url; it expires, so it is refreshed on every list read. */
  avatarUrl?: string | null;
  fullName?: string | null;
  unreadCount?: number;
  profile?: InboxProfile | null;
  contact: Pick<
    Contact,
    "id" | "kind" | "kindSource" | "stage" | "entryPath" | "setterStage" | "paused" | "suggestedKind" | "suggestedReason" | "suggestedConfidence" | "suggestedBy" | "triagedMessageId"
  > | null;
}

export interface InboxMessage {
  id: string;
  text: string;
  fromMe: boolean;
  createdTime: string | null;
}

interface RawThread {
  conversationId: string;
  igUserId: string;
  username: string | null;
  updatedTime: string | null;
  preview: string | null;
  avatarUrl: string | null;
  fullName: string | null;
  unreadCount: number;
  profile: InboxProfile | null;
}

const bool = (v: unknown) => (typeof v === "boolean" ? v : null);

export async function getInboxAccount(workspaceId: string) {
  return prisma.instagramAccount.findFirst({
    where: { workspaceId },
    orderBy: { connectedAt: "desc" },
  });
}

/** Threads from Zernio (or Meta), newest first. Zernio's list carries the last
 *  message text, which the upstream reader drops, so we read it directly. */
async function readThreads(account: InstagramAccount): Promise<RawThread[]> {
  const context = await createInstagramContext(account);
  if (context.provider === "ZERNIO") {
    const result = await zernioRequest<{
      data: {
        id: string;
        participantId?: string;
        participantUsername?: string;
        participantName?: string;
        participantPicture?: string;
        updatedTime: string;
        lastMessage?: string;
        unreadCount?: number;
        instagramProfile?: { isFollower?: boolean; isFollowing?: boolean; followerCount?: number; isVerified?: boolean } | null;
      }[];
    }>({
      apiKey: context.apiKey,
      path: `/inbox/conversations?accountId=${encodeURIComponent(context.accountId)}&limit=50`,
    });
    return result.data
      .filter((c) => c.participantId)
      .map((c) => ({
        conversationId: c.id,
        igUserId: c.participantId!,
        username: c.participantUsername ?? null,
        updatedTime: c.updatedTime ?? null,
        preview: c.lastMessage ?? null,
        avatarUrl: c.participantPicture || null,
        fullName: c.participantName || null,
        unreadCount: typeof c.unreadCount === "number" ? c.unreadCount : 0,
        profile: c.instagramProfile
          ? {
              isFollower: bool(c.instagramProfile.isFollower),
              isFollowing: bool(c.instagramProfile.isFollowing),
              followerCount: typeof c.instagramProfile.followerCount === "number" ? c.instagramProfile.followerCount : null,
              isVerified: bool(c.instagramProfile.isVerified),
            }
          : null,
      }));
  }

  const raw = await getConversations({ context, igUserId: account.instagramId });
  return raw.flatMap((c) => {
    const other = c.participants?.data?.find((p) => p.id !== account.instagramId);
    if (!other) return [];
    return [
      {
        conversationId: c.id,
        igUserId: other.id,
        username: other.username ?? null,
        updatedTime: c.updated_time ?? null,
        preview: c.messages?.data?.[0]?.message ?? null,
        avatarUrl: null,
        fullName: null,
        unreadCount: 0,
        profile: null,
      },
    ];
  });
}

/**
 * The inbox list. Every thread we read is recorded as a Contact, so contacts
 * fill up from the inbox even before the webhook writes them. Someone who
 * commented on one of our campaigns comes in as sales.
 */
export async function listThreads(workspaceId: string): Promise<{ account: InstagramAccount | null; threads: InboxThread[] }> {
  if (osMockEnabled()) return { account: null, threads: mockThreads() };

  const account = await getInboxAccount(workspaceId);
  if (!account) return { account: null, threads: [] };

  const raw = await readThreads(account);
  const commenters = new Set(
    (
      await prisma.dmLog.findMany({
        where: { instagramAccountId: account.id, commenterId: { in: raw.map((t) => t.igUserId) } },
        select: { commenterId: true },
        distinct: ["commenterId"],
      })
    ).map((l) => l.commenterId)
  );

  const contacts = await Promise.all(
    raw.map((t) =>
      upsertContact({
        workspaceId,
        instagramAccountId: account.id,
        igUserId: t.igUserId,
        username: t.username,
        fullName: t.fullName,
        avatarUrl: t.avatarUrl,
        zernioConversationId: t.conversationId,
        entryPath: commenters.has(t.igUserId) ? "comment" : null,
        at: t.updatedTime ? new Date(t.updatedTime) : undefined,
      })
    )
  );

  // New Unsorted contacts get J's sales/personal guess in the background.
  const untriaged = contacts.filter((c) => c.kind === "UNSORTED" && !c.triagedAt && c.zernioConversationId).map((c) => c.id);
  if (untriaged.length && !triageDisabled()) {
    void enqueueTriageMany(untriaged, "new").catch((err) =>
      console.error("[OS Inbox] could not queue triage:", err instanceof Error ? err.message : err)
    );
  }

  return {
    account,
    threads: raw.map((t, i) => ({ ...t, contact: contacts[i] })),
  };
}

export async function getThreadMessages(workspaceId: string, conversationId: string): Promise<InboxMessage[]> {
  if (osMockEnabled()) return mockMessages(conversationId);

  const account = await getInboxAccount(workspaceId);
  if (!account) return [];
  const context = await createInstagramContext(account);
  const raw = await getConversationMessages({ context, conversationId });
  return raw
    .map((m) => ({
      id: m.id,
      text: m.message ?? "",
      fromMe: m.from?.id === account.instagramId,
      createdTime: m.created_time ?? null,
    }))
    .reverse();
}

export interface SendReplyOptions {
  /** Send under Meta's HUMAN_AGENT tag: allowed up to 7 days after their last
   *  message, for a person replying by hand. Only ever after an approval. */
  humanAgent?: boolean;
  /** The Zernio conversation, needed for the HUMAN_AGENT send. */
  conversationId?: string | null;
}

export async function sendReply(workspaceId: string, igUserId: string, text: string, options: SendReplyOptions = {}) {
  if (osMockEnabled()) {
    if (options.conversationId) appendMockMessage(options.conversationId, text);
    return;
  }

  const account = await getInboxAccount(workspaceId);
  if (!account) throw new Error("Instagram account not connected.");
  const context = await createInstagramContext(account);
  if (options.humanAgent) {
    if (context.provider !== "ZERNIO" || !options.conversationId) {
      throw new Error("Outside the 24-hour window this only sends through Zernio.");
    }
    await zernioRequest({
      apiKey: context.apiKey,
      method: "POST",
      path: `/inbox/conversations/${encodeURIComponent(options.conversationId)}/messages`,
      body: { accountId: context.accountId, message: text, messagingType: "MESSAGE_TAG", messageTag: "HUMAN_AGENT" },
    });
    return;
  }
  await sendDirectMessage({
    context,
    instagramAccountId: account.instagramId,
    userId: igUserId,
    message: text,
  });
}
