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
import { voiceByMessage } from "@/lib/os/voice/store";
import { appendMockMessage, mockThreads, osMockEnabled } from "@/lib/os/mock";
import { assertCanSend, recordSend } from "@/lib/os/sending/cap";
import { fillStoryCards, mediaForMessages, type MediaView } from "@/lib/os/media";
import { parseZernioMessages, splitLinks } from "@/lib/os/messages/parse";
import type { RichMessage } from "@/lib/os/messages/types";
import { leadMagnetsByMessage, markSetterMessages, sentBubbleSet, type ThreadExtras } from "@/lib/os/messages/view";
import { MOCK_OPENER_BY_AUTOMATION, markMockHeld, mockLeadMagnets, mockSentDrafts, mockThreadMedia, mockThreadMessages } from "@/lib/os/mock-thread";
import { discardDraft } from "@/lib/os/setter/service";
import { defaultSetterId } from "@/lib/os/setter/setters";
import { DEFAULT_SETTINGS, getWorkspaceSettings } from "@/lib/os/workspace-settings";

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
    "id" | "kind" | "kindSource" | "stage" | "entryPath" | "setterStage" | "paused" | "suggestedKind" | "suggestedReason" | "suggestedConfidence" | "suggestedBy" | "triagedMessageId" | "onFriday" | "seenAt"
  > | null;
}

export interface InboxMessage {
  id: string;
  text: string;
  fromMe: boolean;
  createdTime: string | null;
  /** An image or file they sent ("image", …). */
  attachment?: string | null;
  /** A voice note we sent (lib/os/voice): the player and the line said. */
  voice?: InboxVoice | null;
}

export interface InboxVoice {
  /** Same-origin path to the file. */
  url: string;
  transcript: string;
  durationMs: number | null;
  /** bank | manual | oneoff */
  kind?: string;
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

export interface SendReplyOptions {
  /** Send under Meta's HUMAN_AGENT tag: allowed up to 7 days after their last
   *  message, for a person replying by hand. Only ever after an approval. */
  humanAgent?: boolean;
  /** The Zernio conversation, needed for the HUMAN_AGENT send. */
  conversationId?: string | null;
  /** Makes the cap count idempotent on retry, e.g. "<draftId>:<bubble>". */
  sendKey?: string | null;
  contactId?: string | null;
}

export async function sendReply(workspaceId: string, igUserId: string, text: string, options: SendReplyOptions = {}) {
  // Send cap + Pause all (lib/os/sending/cap.ts): every bubble counts.
  await assertCanSend(workspaceId);
  await sendReplyUnguarded(workspaceId, igUserId, text, options);
  await recordSend(workspaceId, { contactId: options.contactId, key: options.sendKey, source: "reply" });
}

async function sendReplyUnguarded(workspaceId: string, igUserId: string, text: string, options: SendReplyOptions) {
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

// ---------------------------------------------------------------- Inbox A (S1)
// The thread as Instagram shows it: the raw Zernio messages through the
// shared parser (lib/os/messages/parse.ts), newest 50 first, older pages on
// demand, plus what the view needs around them (media rows, J marker, lead
// magnet chips, opener keywords).

/** Messages per page in the thread (newest first from Zernio). */
export const THREAD_PAGE = 50;

export interface ThreadPage {
  /** Oldest first. */
  messages: RichMessage[];
  /** Pass back for the next older page; null when there is none. */
  cursor: string | null;
}

export interface ThreadData extends ThreadPage {
  conversationId: string;
  extras: ThreadExtras;
  /** The workspace timezone for the centred timestamps. */
  tz: string;
}

/** One page of a conversation, parsed. Meta (no Zernio) gives text only. */
export async function readThreadPage(workspaceId: string, conversationId: string, cursor: string | null = null): Promise<ThreadPage> {
  if (osMockEnabled()) return { messages: mockThreadMessages(conversationId), cursor: null };

  const account = await getInboxAccount(workspaceId);
  if (!account) return { messages: [], cursor: null };
  const context = await createInstagramContext(account);
  const voice = await voiceByMessage(workspaceId, conversationId).catch(() => new Map<string, InboxVoice>());

  let messages: RichMessage[];
  let next: string | null = null;
  if (context.provider === "ZERNIO") {
    const params = new URLSearchParams({ accountId: context.accountId, limit: String(THREAD_PAGE), sortOrder: "desc", ...(cursor ? { cursor } : {}) });
    const page = await zernioRequest<{ messages?: unknown[]; data?: unknown[]; pagination?: { hasMore?: boolean; nextCursor?: string } }>({
      apiKey: context.apiKey,
      path: `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params}`,
    });
    messages = parseZernioMessages(page.messages ?? page.data ?? []);
    next = page.pagination?.hasMore && page.pagination.nextCursor ? page.pagination.nextCursor : null;
  } else {
    if (cursor) return { messages: [], cursor: null };
    const raw = await getConversationMessages({ context, conversationId });
    messages = raw
      .map((m) => {
        const fromMe = m.from?.id === account.instagramId;
        return {
          id: m.id,
          direction: fromMe ? "outgoing" : "incoming",
          fromMe,
          at: m.created_time ?? null,
          parts: splitLinks(m.message ?? ""),
          reactions: [],
          seenAt: null,
          deliveryStatus: null,
          origin: null,
          automationId: null,
          fromSetter: false,
          quotedMessageId: null,
          deleted: false,
          edited: false,
          refreshUrl: null,
        } satisfies RichMessage;
      })
      .reverse();
  }
  // Our own voice notes: the player and the line said.
  messages = messages.map((m) => {
    const v = voice.get(m.id);
    return v ? { ...m, fromSetter: true, parts: [{ type: "voice", url: v.url, durationMs: v.durationMs }] } : m;
  });
  return { messages, cursor: next };
}

/** Everything around the messages the thread view needs. Failures only hide
 *  marks (no J marker, no chip), never the thread. */
export async function threadExtras(
  workspaceId: string,
  conversationId: string,
  contactId: string | null,
  messages: RichMessage[]
): Promise<{ messages: RichMessage[]; extras: ThreadExtras }> {
  const ids = messages.map((m) => m.id);
  if (osMockEnabled()) {
    const sent = sentBubbleSet(mockSentDrafts(contactId));
    return {
      messages: markSetterMessages(messages, sent),
      extras: {
        setterName: "J",
        media: await mockThreadMedia(conversationId, messages),
        leadMagnetByMessage: mockLeadMagnets(),
        openerByAutomation: MOCK_OPENER_BY_AUTOMATION,
      },
    };
  }

  const automationIds = [...new Set(messages.map((m) => m.automationId).filter((x): x is string => Boolean(x)))];
  const [media, drafts, resources, automations, setterName] = await Promise.all([
    mediaForMessages(workspaceId, ids)
      .catch(() => new Map<string, MediaView>())
      .then((m) => fillStoryCards(workspaceId, messages, m)),
    contactId
      ? prisma.draft.findMany({ where: { workspaceId, contactId, status: "SENT" }, select: { bubbles: true, editedText: true }, orderBy: { createdAt: "desc" }, take: 200 }).catch(() => [])
      : Promise.resolve([]),
    prisma.resource.findMany({ where: { workspaceId, link: { not: null } }, select: { name: true, link: true } }).catch(() => []),
    automationIds.length
      ? prisma.automation.findMany({ where: { id: { in: automationIds } }, select: { id: true, keywords: true } }).catch(() => [])
      : Promise.resolve([]),
    contactSetterName(workspaceId, contactId),
  ]);
  const marked = markSetterMessages(messages, sentBubbleSet(drafts));
  return {
    messages: marked,
    extras: {
      setterName,
      media: Object.fromEntries(media),
      leadMagnetByMessage: leadMagnetsByMessage(marked, resources),
      openerByAutomation: Object.fromEntries(automations.filter((a) => a.keywords[0]).map((a) => [a.id, a.keywords[0].toUpperCase()])),
    },
  };
}

async function contactSetterName(workspaceId: string, contactId: string | null): Promise<string> {
  if (!contactId) return "J";
  try {
    const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { setterId: true, instagramAccountId: true } });
    const id = c?.setterId ?? (c ? await defaultSetterId(workspaceId, c.instagramAccountId) : null);
    const s = id ? await prisma.setter.findFirst({ where: { id, workspaceId }, select: { name: true } }) : null;
    return s?.name || "J";
  } catch {
    return "J";
  }
}

/** The open thread: newest page, parsed, with its extras. */
export async function loadThreadData(workspaceId: string, conversationId: string, contactId: string | null, cursor: string | null = null): Promise<ThreadData> {
  const [page, settings] = await Promise.all([
    readThreadPage(workspaceId, conversationId, cursor),
    osMockEnabled() ? Promise.resolve(null) : getWorkspaceSettings(workspaceId).catch(() => null),
  ]);
  const { messages, extras } = await threadExtras(workspaceId, conversationId, contactId, page.messages);
  return { conversationId, messages, cursor: page.cursor, extras, tz: settings?.timezone ?? DEFAULT_SETTINGS.timezone };
}

// ---------------------------------------------------------------- Hold

export interface HoldDeps {
  /** Takes the draft out of review and records J's skip (service.discardDraft). */
  discard: (draftId: string, workspaceId: string) => Promise<{ error?: string }>;
  /** Stamps Draft.heldAt / heldReason. */
  markHeld: (draftId: string, workspaceId: string, reason: string | null) => Promise<void>;
}

const holdDeps = (): HoldDeps => ({
  discard: (id, ws) => discardDraft(id, ws),
  markHeld: async (id, ws, reason) => {
    if (osMockEnabled()) return markMockHeld(id, reason);
    await prisma.draft.updateMany({ where: { id, workspaceId: ws }, data: { heldAt: new Date(), heldReason: reason } });
  },
});

/** Hold: say nothing for now. The draft leaves the review queue (like a
 *  discard, so J won't redraft the same message) but is stamped as held,
 *  so it reads as a choice to wait, not a rejected draft. J drafts again
 *  when they write next. Nothing is sent. */
export async function holdDraft(draftId: string, workspaceId: string, reason: string | null = null, deps: HoldDeps = holdDeps()): Promise<{ error?: string }> {
  const r = await deps.discard(draftId, workspaceId);
  if (r.error) return r;
  await deps.markHeld(draftId, workspaceId, reason?.trim().slice(0, 200) || null);
  return {};
}
