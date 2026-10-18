// Reads one conversation the way J needs it: oldest first, with button DMs,
// taps and story replies flattened into text (resources.flattenMessage). The
// upstream reader keeps only `message` and the last 20, which hides every
// button DM, so Zernio threads are read here directly.

import type { InstagramAccount } from "@/app/generated/prisma/client";
import { createInstagramContext, getConversationMessages } from "@/lib/instagram/provider";
import { flattenMessage, type ZernioMessage } from "@/lib/os/setter/resources";
import type { ThreadMessage } from "@/lib/os/setter/state";
import { zernioRequest } from "@/lib/zernio/client";

/** Messages kept per person and sent to the model: the whole conversation. */
export const THREAD_CAP = 400;

export function normaliseZernio(raw: ZernioMessage[]): ThreadMessage[] {
  return raw
    .map((m) => ({
      id: String(m.id ?? m._id ?? ""),
      text: flattenMessage(m),
      incoming: m.direction === "incoming",
      at: m.createdAt ?? m.timestamp ?? "",
      story_reply: Boolean(m.storyReply),
      postback: Boolean(m.metadata?.postbackTitle || m.metadata?.postbackPayload || m.type === "postback"),
      attachment: mediaAttachment(m),
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** The type of an image/file they sent (their invite screenshot), or null.
 *  Button templates and generic cards are our own DMs, not attachments. */
export function mediaAttachment(m: ZernioMessage): string | null {
  for (const a of m.attachments ?? []) {
    if (!a.type || a.type === "template" || a.payload?.generic?.elements?.length) continue;
    return a.type;
  }
  return null;
}

export async function readSetterThread(account: InstagramAccount, conversationId: string): Promise<ThreadMessage[]> {
  const context = await createInstagramContext(account);
  if (context.provider === "ZERNIO") {
    const out: ZernioMessage[] = [];
    let cursor: string | undefined;
    while (out.length < THREAD_CAP) {
      const params = new URLSearchParams({
        accountId: context.accountId,
        limit: String(Math.min(100, THREAD_CAP - out.length)),
        sortOrder: "desc",
        ...(cursor ? { cursor } : {}),
      });
      const page = await zernioRequest<{
        messages?: ZernioMessage[];
        data?: ZernioMessage[];
        pagination?: { hasMore?: boolean; nextCursor?: string };
      }>({ apiKey: context.apiKey, path: `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params}` });
      const rows = page.messages ?? page.data ?? [];
      out.push(...rows);
      cursor = page.pagination?.nextCursor;
      if (!rows.length || !page.pagination?.hasMore || !cursor) break;
    }
    return normaliseZernio(out);
  }

  // Meta Graph: text only (no attachments), newest first from the API.
  const raw = await getConversationMessages({ context, conversationId });
  return raw
    .map((m) => ({
      id: m.id,
      text: m.message ?? "",
      incoming: m.from?.id !== account.instagramId,
      at: m.created_time ?? "",
    }))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}
