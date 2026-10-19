// Real wiring for enrichment: Zernio reads, CDN downloads, provider adapters,
// Data OS. The os-media-enrich job (lib/os/setter/queue.ts) runs
// enrichConversation right after a message arrives; readSetterThread calls
// enrichForThread as the fallback with a 20s budget.

import type { InstagramAccount } from "@/app/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { createInstagramContext, type ZernioContext } from "@/lib/instagram/provider";
import { dataOsFor } from "@/lib/os/dataos/store";
import { resolveDescriber } from "@/lib/os/media/describe";
import { detectAll, detectMedia, type MediaItem } from "@/lib/os/media/detect";
import { dailyMaxFromEnv, ensureEnriched, ExpiredMediaError, type EnrichDeps, type EnrichTarget, type MediaRow } from "@/lib/os/media/enrich";
import { dbMediaStore } from "@/lib/os/media/store";
import { resolveTranscriber, type MediaBytes } from "@/lib/os/media/transcribe";
import { parseZernioMessage, parseZernioMessages } from "@/lib/os/messages/parse";
import type { RichMessage } from "@/lib/os/messages/types";
import { zernioRequest } from "@/lib/zernio/client";

/** Bigger than any voice note or screenshot; OpenAI's upload limit. */
export const MAX_MEDIA_BYTES = 25 * 1024 * 1024;
const ZERNIO_BASE = "https://zernio.com/api/v1";

export async function downloadMedia(url: string, send: typeof fetch = fetch): Promise<MediaBytes> {
  const res = await send(url, { signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (res.status === 403 || res.status === 404 || res.status === 410) throw new ExpiredMediaError(res.status);
  if (!res.ok) throw new Error(`download failed (HTTP ${res.status})`);
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > MAX_MEDIA_BYTES) throw new Error("media is too large");
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > MAX_MEDIA_BYTES) throw new Error("media is too large");
  return { bytes: buf, contentType: res.headers.get("content-type") };
}

/** The Zernio API path of a refreshUrl (absolute or relative), or null. */
export function refreshPath(refreshUrl: string | null, conversationId: string, messageId: string): string {
  if (refreshUrl?.startsWith(ZERNIO_BASE + "/")) return refreshUrl.slice(ZERNIO_BASE.length);
  if (refreshUrl?.startsWith("/")) return refreshUrl;
  return `/inbox/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`;
}

/** Fresh CDN url of one message through Zernio's refreshUrl. */
export async function refreshViaZernio(ctx: ZernioContext, conversationId: string, item: MediaItem): Promise<string | null> {
  const path = refreshPath(item.refreshUrl, conversationId, item.messageId);
  const sep = path.includes("?") ? "&" : "?";
  const body = await zernioRequest<Record<string, unknown>>({ apiKey: ctx.apiKey, path: `${path}${sep}accountId=${encodeURIComponent(ctx.accountId)}` });
  const raw = (body?.message && typeof body.message === "object" ? body.message : body?.data && typeof body.data === "object" ? body.data : body) as unknown;
  const fresh = detectMedia(parseZernioMessage(raw));
  return fresh?.sourceUrl ?? null;
}

export async function enrichDeps(workspaceId: string, ctx: ZernioContext | null, conversationId: string): Promise<EnrichDeps> {
  return {
    store: dbMediaStore,
    transcriber: resolveTranscriber(),
    describer: resolveDescriber(),
    dataOs: await dataOsFor(workspaceId).catch(() => null),
    download: (url) => downloadMedia(url),
    refresh: async (item) => (ctx ? refreshViaZernio(ctx, conversationId, item) : null),
    dailyMax: dailyMaxFromEnv(),
  };
}

export async function targetFor(workspaceId: string, conversationId: string): Promise<EnrichTarget> {
  const c = await prisma.contact.findFirst({ where: { workspaceId, zernioConversationId: conversationId }, select: { id: true, kind: true } });
  return { workspaceId, conversationId, contactId: c?.id ?? null, kind: c?.kind ?? null };
}

/** Called by readSetterThread with the messages it read: enrich what's new
 *  (within the budget) and return every row for the thread. Never throws. */
export async function enrichForThread(
  account: Pick<InstagramAccount, "workspaceId">,
  ctx: ZernioContext,
  conversationId: string,
  msgs: RichMessage[],
  budgetMs = 20_000
): Promise<Map<string, MediaRow>> {
  try {
    const items = detectAll(msgs);
    if (!items.length) return new Map();
    const target = await targetFor(account.workspaceId, conversationId);
    return await ensureEnriched(await enrichDeps(account.workspaceId, ctx, conversationId), target, items, { budgetMs });
  } catch (err) {
    console.error("[OS Media] enrich for thread failed:", err instanceof Error ? err.message : err);
    return new Map();
  }
}

export interface MediaEnrichJobData {
  workspaceId: string;
  conversationId: string;
  /** One message, or the newest messages of the conversation when absent. */
  messageId?: string;
}

/** The os-media-enrich job: read the newest messages and save their media. */
export async function enrichConversation(job: MediaEnrichJobData): Promise<{ enriched: number; skipped?: string }> {
  const account = await prisma.instagramAccount.findFirst({ where: { workspaceId: job.workspaceId, provider: "ZERNIO" } });
  if (!account) return { enriched: 0, skipped: "no Zernio account" };
  const ctx = await createInstagramContext(account);
  if (ctx.provider !== "ZERNIO") return { enriched: 0, skipped: "not Zernio" };
  const target = await targetFor(job.workspaceId, job.conversationId);
  if (target.kind && target.kind !== "SALES" && target.kind !== "UNSORTED") return { enriched: 0, skipped: `${target.kind} thread` };
  const params = new URLSearchParams({ accountId: ctx.accountId, limit: "20", sortOrder: "desc" });
  const page = await zernioRequest<{ messages?: unknown[]; data?: unknown[] }>({
    apiKey: ctx.apiKey,
    path: `/inbox/conversations/${encodeURIComponent(job.conversationId)}/messages?${params}`,
  });
  let items = detectAll(parseZernioMessages(page.messages ?? page.data ?? [])).filter((i) => i.direction === "incoming");
  if (job.messageId) items = items.filter((i) => i.messageId === job.messageId);
  if (!items.length) return { enriched: 0 };
  const rows = await ensureEnriched(await enrichDeps(job.workspaceId, ctx, job.conversationId), target, items, { budgetMs: 120_000 });
  return { enriched: items.filter((i) => rows.get(i.messageId)?.status === "done").length };
}
