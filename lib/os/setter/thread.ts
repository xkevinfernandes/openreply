// Reads one conversation the way J needs it: oldest first, every message as
// text. Button DMs and taps read as their copy, and media reads as what it
// says or shows (lib/os/media): [voice note] "…", [photo: …],
// [shared a reel: "…"], [replying to your story "…"]. Media that isn't saved
// yet is enriched here first, within a 20s budget, so J drafts from what a
// lead said in a voice note. The upstream reader keeps only `message` and the
// last 20, which hides every button DM, so Zernio threads are read directly.

import type { InstagramAccount } from "@/app/generated/prisma/client";
import { createInstagramContext, getConversationMessages } from "@/lib/instagram/provider";
import { messageText } from "@/lib/os/media/detect";
import type { MediaView } from "@/lib/os/media/index";
import { parseZernioMessages } from "@/lib/os/messages/parse";
import type { RichMessage } from "@/lib/os/messages/types";
import type { ZernioMessage } from "@/lib/os/setter/resources";
import type { ThreadMessage } from "@/lib/os/setter/state";
import { zernioRequest } from "@/lib/zernio/client";

/** Messages kept per person and sent to the model: the whole conversation. */
export const THREAD_CAP = 400;
/** How long J's read waits for new media to be transcribed or described. */
export const ENRICH_BUDGET_MS = 20_000;

/** The type of media they sent that counts as "an attachment" (their invite
 *  screenshot), or null. A transcribed voice note is speech, not a file. */
export function attachmentOf(m: RichMessage, media?: Pick<MediaView, "transcript"> | null): string | null {
  for (const p of m.parts) {
    if (p.type === "image" || p.type === "file" || p.type === "video") return p.type;
    if (p.type === "voice" && !media?.transcript) return "audio";
  }
  return null;
}

/** One parsed message -> J's ThreadMessage. */
export function toThreadMessage(m: RichMessage, media?: MediaView | null): ThreadMessage {
  return {
    id: m.id,
    text: messageText(m, media),
    incoming: m.direction === "incoming",
    at: m.at ?? "",
    story_reply: m.parts.some((p) => p.type === "story_reply"),
    postback: m.parts.some((p) => p.type === "postback"),
    attachment: attachmentOf(m, media),
    card: m.parts.some((p) => p.type === "template"),
  };
}

/** Raw Zernio messages (any order) + saved media -> J's thread, oldest first. */
export function normaliseZernio(raw: ZernioMessage[] | unknown[], media: ReadonlyMap<string, MediaView> = new Map()): ThreadMessage[] {
  return parseZernioMessages(raw as unknown[]).map((m) => toThreadMessage(m, media.get(m.id)));
}

export async function readSetterThread(account: InstagramAccount, conversationId: string): Promise<ThreadMessage[]> {
  const context = await createInstagramContext(account);
  if (context.provider === "ZERNIO") {
    const out: unknown[] = [];
    let cursor: string | undefined;
    while (out.length < THREAD_CAP) {
      const params = new URLSearchParams({
        accountId: context.accountId,
        limit: String(Math.min(100, THREAD_CAP - out.length)),
        sortOrder: "desc",
        ...(cursor ? { cursor } : {}),
      });
      const page = await zernioRequest<{
        messages?: unknown[];
        data?: unknown[];
        pagination?: { hasMore?: boolean; nextCursor?: string };
      }>({ apiKey: context.apiKey, path: `/inbox/conversations/${encodeURIComponent(conversationId)}/messages?${params}` });
      const rows = page.messages ?? page.data ?? [];
      out.push(...rows);
      cursor = page.pagination?.nextCursor;
      if (!rows.length || !page.pagination?.hasMore || !cursor) break;
    }
    const rich = parseZernioMessages(out);
    // Lazy: keeps prisma and the provider adapters out of pure imports of this module.
    const { enrichForThread } = await import("@/lib/os/media/jobs");
    const { toView } = await import("@/lib/os/media/enrich");
    const rows = await enrichForThread(account, context, conversationId, rich, ENRICH_BUDGET_MS);
    const media = new Map([...rows].map(([id, r]) => [id, toView(r)]));
    return rich.map((m) => toThreadMessage(m, media.get(m.id)));
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
