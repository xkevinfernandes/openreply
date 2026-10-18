import type { ContactKind } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";

/** Entry paths that only come from our own lead-magnet funnels: these
 *  contacts are sales from the first message. Everyone else starts unsorted. */
const SALES_ENTRY_PATHS = new Set(["comment", "keyword_dm", "story_reply", "setter_comment"]);

export function kindForEntry(entryPath: string | null | undefined): ContactKind {
  return entryPath && SALES_ENTRY_PATHS.has(entryPath) ? "SALES" : "UNSORTED";
}

interface ContactSeen {
  workspaceId: string;
  instagramAccountId: string;
  /** Instagram-scoped id: DmLog.commenterId or the DM sender id. */
  igUserId: string;
  username?: string | null;
  fullName?: string | null;
  /** Instagram CDN url; expires, so every list read refreshes it. */
  avatarUrl?: string | null;
  entryPath?: string | null;
  zernioConversationId?: string | null;
  at?: Date;
}

/**
 * Record that we saw this person. Creates the contact on first sight (kind
 * from the entry path); afterwards only refreshes the handle, thread id and
 * last-message time, so a kind or stage the user set is never overwritten.
 */
export async function upsertContact(seen: ContactSeen) {
  const at = seen.at ?? new Date();
  const kind = kindForEntry(seen.entryPath);

  return prisma.contact.upsert({
    where: {
      workspaceId_instagramAccountId_igUserId: {
        workspaceId: seen.workspaceId,
        instagramAccountId: seen.instagramAccountId,
        igUserId: seen.igUserId,
      },
    },
    create: {
      workspaceId: seen.workspaceId,
      instagramAccountId: seen.instagramAccountId,
      igUserId: seen.igUserId,
      username: seen.username ?? null,
      fullName: seen.fullName ?? null,
      avatarUrl: seen.avatarUrl ?? null,
      entryPath: seen.entryPath ?? null,
      zernioConversationId: seen.zernioConversationId ?? null,
      kind,
      kindSource: kind === "SALES" ? "entry" : null,
      lastMessageAt: at,
    },
    update: {
      ...(seen.username ? { username: seen.username } : {}),
      ...(seen.fullName ? { fullName: seen.fullName } : {}),
      ...(seen.avatarUrl ? { avatarUrl: seen.avatarUrl } : {}),
      ...(seen.zernioConversationId ? { zernioConversationId: seen.zernioConversationId } : {}),
      lastMessageAt: at,
    },
  });
}
