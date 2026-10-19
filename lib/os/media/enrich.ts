// Save what a lead's media says, at arrival (CDN urls expire within days):
// voice -> transcript, image -> description, share -> caption, story reply ->
// the story card from Data OS. One MessageMedia row per message, idempotent:
// a row that is done, skipped or expired is never redone.
//
// Cost guard: model calls (voice, image) only for SALES and UNSORTED
// contacts, at most OS_MEDIA_DAILY_MAX per workspace per day. Personal and
// Pitches threads are recorded as skipped and cost nothing.

import type { ContactKind } from "@/app/generated/prisma/client";
import type { DataOs } from "@/lib/os/dataos/types";
import { MODEL_KINDS, type MediaItem } from "@/lib/os/media/detect";
import type { Describer } from "@/lib/os/media/describe";
import type { MediaView } from "@/lib/os/media/index";
import type { MediaBytes, Transcriber } from "@/lib/os/media/transcribe";

export type MediaStatus = MediaView["status"];

export interface MediaRow {
  workspaceId: string;
  contactId: string | null;
  conversationId: string;
  messageId: string;
  direction: string;
  kind: MediaView["kind"];
  sourceUrl: string | null;
  status: MediaStatus;
  transcript: string | null;
  description: string | null;
  caption: string | null;
  story: MediaView["story"];
  provider: string | null;
  error: string | null;
  attempts: number;
  durationMs?: number | null;
  updatedAt?: Date;
}

export interface MediaStore {
  get(workspaceId: string, messageIds: string[]): Promise<Map<string, MediaRow>>;
  save(row: MediaRow): Promise<void>;
  /** Model calls (voice/image attempts) made in this workspace since `since`. */
  modelCallsSince(workspaceId: string, since: Date): Promise<number>;
}

export class ExpiredMediaError extends Error {
  constructor(readonly status: number) {
    super(`media url expired (HTTP ${status})`);
    this.name = "ExpiredMediaError";
  }
}

export interface EnrichDeps {
  store: MediaStore;
  transcriber: Transcriber | null;
  describer: Describer | null;
  dataOs: DataOs | null;
  /** Bytes of a CDN url. Throws ExpiredMediaError on 403/404/410. */
  download(url: string): Promise<MediaBytes>;
  /** A fresh url for this item through Zernio's refreshUrl, or null. */
  refresh(item: MediaItem): Promise<string | null>;
  dailyMax?: number;
  now?: () => Date;
}

export interface EnrichTarget {
  workspaceId: string;
  conversationId: string;
  contactId: string | null;
  /** null: the contact isn't known yet (treated like Unsorted). */
  kind: ContactKind | null;
}

export const MAX_ATTEMPTS = 3;
export const DEFAULT_DAILY_MAX = 300;
export const DEFAULT_BUDGET_MS = 20_000;

export function dailyMaxFromEnv(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.OS_MEDIA_DAILY_MAX);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_DAILY_MAX;
}

/** J may spend on this contact's media. */
export function kindAllowed(kind: ContactKind | null): boolean {
  return kind == null || kind === "SALES" || kind === "UNSORTED";
}

/** Final rows are never redone; failed ones retry up to MAX_ATTEMPTS. */
export function isFinal(row: MediaRow | undefined | null): boolean {
  if (!row) return false;
  if (row.status === "done" || row.status === "skipped" || row.status === "expired") return true;
  return row.status === "failed" && row.attempts >= MAX_ATTEMPTS;
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 300);

/** Enrich one message's media. Returns the saved row. Never throws. */
export async function enrichOne(deps: EnrichDeps, target: EnrichTarget, item: MediaItem, existing?: MediaRow | null): Promise<MediaRow> {
  const prev = existing === undefined ? (await deps.store.get(target.workspaceId, [item.messageId])).get(item.messageId) : existing;
  if (prev && isFinal(prev)) return prev;

  const row: MediaRow = {
    workspaceId: target.workspaceId,
    contactId: target.contactId,
    conversationId: target.conversationId,
    messageId: item.messageId,
    direction: item.direction,
    kind: item.kind,
    sourceUrl: item.sourceUrl ?? prev?.sourceUrl ?? null,
    status: "pending",
    transcript: prev?.transcript ?? null,
    description: prev?.description ?? null,
    caption: item.caption ?? prev?.caption ?? null,
    story: prev?.story ?? null,
    provider: prev?.provider ?? null,
    error: null,
    attempts: prev?.attempts ?? 0,
  };
  const finish = async (patch: Partial<MediaRow>): Promise<MediaRow> => {
    const out = { ...row, ...patch };
    try {
      await deps.store.save(out);
    } catch (err) {
      console.error("[OS Media] could not save", item.messageId, errText(err));
    }
    return out;
  };

  if (!kindAllowed(target.kind)) return finish({ status: "skipped", error: `${target.kind?.toLowerCase()} thread` });
  // Our own media: J wrote it, nothing to learn (our voice notes have their line in lib/os/voice).
  if (item.direction === "outgoing" && item.kind !== "share" && item.kind !== "story_reply") return finish({ status: "skipped", error: "sent by us" });

  try {
    if (item.kind === "story_reply") {
      const story = deps.dataOs && item.story ? await deps.dataOs.storyFor(item.story) : null;
      return finish({ status: "done", story: story ?? null, provider: deps.dataOs ? "dataos" : null });
    }
    if (item.kind === "share") {
      const ours = deps.dataOs && item.mediaId ? await deps.dataOs.contentByMediaId(item.mediaId) : null;
      return finish({ status: "done", story: ours ?? null, caption: item.caption ?? ours?.caption ?? null, provider: ours ? "dataos" : "payload" });
    }
    if (!MODEL_KINDS.has(item.kind)) return finish({ status: "skipped", error: `${item.kind} is not enriched` });

    const model = item.kind === "voice" ? deps.transcriber : deps.describer;
    if (!model) return finish({ status: "skipped", error: "no provider key" });

    const now = deps.now?.() ?? new Date();
    const used = await deps.store.modelCallsSince(target.workspaceId, startOfUtcDay(now));
    if (used >= (deps.dailyMax ?? DEFAULT_DAILY_MAX)) {
      // Stays pending: the next look (tomorrow's budget) picks it up.
      return finish({ status: "pending", error: "daily media limit reached" });
    }

    const bytes = await fetchFresh(deps, item, row);
    if (!bytes) return finish({ status: "expired", error: "media url expired and could not be refreshed" });
    row.attempts += 1;
    if (item.kind === "voice") {
      const transcript = (await deps.transcriber!.transcribe(bytes)).trim();
      return finish({ status: "done", transcript: transcript || "(no speech)", provider: deps.transcriber!.name });
    }
    const description = (await deps.describer!.describe(bytes)).trim();
    return finish({ status: "done", description, provider: deps.describer!.name });
  } catch (err) {
    if (row.attempts === (prev?.attempts ?? 0)) row.attempts += 1;
    return finish({ status: "failed", error: errText(err) });
  }
}

/** Download, refreshing the url once when it expired. Null when it stays gone. */
async function fetchFresh(deps: EnrichDeps, item: MediaItem, row: MediaRow): Promise<MediaBytes | null> {
  if (row.sourceUrl) {
    try {
      return await deps.download(row.sourceUrl);
    } catch (err) {
      if (!(err instanceof ExpiredMediaError)) throw err;
    }
  }
  const fresh = await deps.refresh(item).catch(() => null);
  if (!fresh) return null;
  row.sourceUrl = fresh;
  try {
    return await deps.download(fresh);
  } catch (err) {
    if (err instanceof ExpiredMediaError) return null;
    throw err;
  }
}

/**
 * Enrich every item not done yet, within a time budget (J's read waits at
 * most this long). Returns the rows known when the budget ran out; work still
 * running finishes in the background and is saved.
 */
export async function ensureEnriched(
  deps: EnrichDeps,
  target: EnrichTarget,
  items: MediaItem[],
  opts: { budgetMs?: number; concurrency?: number } = {}
): Promise<Map<string, MediaRow>> {
  const rows = await deps.store.get(target.workspaceId, items.map((i) => i.messageId));
  const todo = items.filter((i) => !isFinal(rows.get(i.messageId)));
  if (!todo.length) return rows;

  const queue = [...todo];
  const worker = async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const row = await enrichOne(deps, target, item, rows.get(item.messageId) ?? null);
      rows.set(item.messageId, row);
    }
  };
  const all = Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, todo.length)) }, worker));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<void>((r) => {
    timer = setTimeout(r, opts.budgetMs ?? DEFAULT_BUDGET_MS);
  });
  await Promise.race([all.catch(() => undefined), budget]);
  clearTimeout(timer);
  return new Map(rows);
}

/** Row -> the view the thread and J read. */
export function toView(row: MediaRow): MediaView {
  return {
    messageId: row.messageId,
    kind: row.kind,
    status: row.status,
    transcript: row.transcript,
    description: row.description,
    caption: row.caption,
    durationMs: row.durationMs ?? null,
    story: row.story ?? null,
  };
}

/** In-memory store (tests, OS_MOCK). */
export function memoryMediaStore(seed: MediaRow[] = []): MediaStore & { rows: Map<string, MediaRow> } {
  const rows = new Map(seed.map((r) => [r.messageId, { ...r }]));
  return {
    rows,
    async get(workspaceId, ids) {
      const out = new Map<string, MediaRow>();
      for (const id of ids) {
        const r = rows.get(id);
        if (r && r.workspaceId === workspaceId) out.set(id, { ...r });
      }
      return out;
    },
    async save(row) {
      rows.set(row.messageId, { ...row, updatedAt: new Date() });
    },
    async modelCallsSince(workspaceId, since) {
      let n = 0;
      for (const r of rows.values()) {
        if (r.workspaceId === workspaceId && MODEL_KINDS.has(r.kind) && r.attempts > 0 && (r.updatedAt ?? new Date()) >= since) n += r.attempts;
      }
      return n;
    },
  };
}
