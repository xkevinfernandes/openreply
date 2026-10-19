// Data OS over HTTP (base URL + bearer token). The real service is wired
// later (plan default 3); this speaks a small read-only contract:
//   GET {base}/status                                -> {ok, ...}
//   GET {base}/stories/lookup?storyId=&assetId=&at=  -> content | 404
//   GET {base}/content/by-media/{mediaId}            -> content | 404
//   GET {base}/stories/recent?days=N                 -> content[] | {items: content[]}
// content = {id, thumbnailUrl, caption, topic, postedAt, permalink}; snake_case
// and a few common aliases are accepted.

import type { DataOs, DataOsContent, DataOsStatus } from "@/lib/os/dataos/types";

export interface DataOsHttpConfig {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export class DataOsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "DataOsError";
  }
}

type Obj = Record<string, unknown>;
const s = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : typeof v === "number" ? String(v) : null);

/** Lenient: one Data OS row -> DataOsContent, or null without an id. */
export function toContent(raw: unknown): DataOsContent | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Obj;
  const id = s(o.id) ?? s(o.storyId) ?? s(o.story_id) ?? s(o.mediaId) ?? s(o.media_id);
  if (!id) return null;
  return {
    id,
    thumbnailUrl: s(o.thumbnailUrl) ?? s(o.thumbnail_url) ?? s(o.thumbnail) ?? s(o.mediaUrl) ?? s(o.media_url),
    caption: s(o.caption) ?? s(o.text) ?? s(o.title),
    topic: s(o.topic) ?? s(o.theme),
    postedAt: s(o.postedAt) ?? s(o.posted_at) ?? s(o.timestamp),
    permalink: s(o.permalink) ?? s(o.url),
  };
}

export function normaliseBase(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new DataOsError("Data OS URL must be http(s)");
  return u.toString().replace(/\/+$/, "");
}

export function createHttpDataOs(cfg: DataOsHttpConfig): DataOs {
  const base = normaliseBase(cfg.baseUrl);
  const send = cfg.fetch ?? fetch;

  async function get(path: string): Promise<unknown | null> {
    let res: Response;
    try {
      res = await send(`${base}${path}`, {
        headers: { Authorization: `Bearer ${cfg.token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(cfg.timeoutMs ?? 10_000),
      });
    } catch (err) {
      throw new DataOsError(`Data OS unreachable: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new DataOsError(`Data OS ${res.status}`, res.status);
    return res.json().catch(() => {
      throw new DataOsError("Data OS answered with something that isn't JSON");
    });
  }

  return {
    async status(): Promise<DataOsStatus> {
      try {
        await get("/status");
        return { connected: true, mode: "http", error: null };
      } catch (err) {
        return { connected: false, mode: "http", error: err instanceof Error ? err.message : String(err) };
      }
    },
    async storyFor(ref) {
      const q = new URLSearchParams();
      if (ref.storyId) q.set("storyId", ref.storyId);
      if (ref.assetId) q.set("assetId", ref.assetId);
      if (ref.at) q.set("at", ref.at);
      if (!ref.storyId && !ref.assetId) return null;
      return toContent(await get(`/stories/lookup?${q}`));
    },
    async contentByMediaId(mediaId) {
      if (!mediaId) return null;
      return toContent(await get(`/content/by-media/${encodeURIComponent(mediaId)}`));
    },
    async recentStories(days) {
      const body = await get(`/stories/recent?days=${Math.max(1, Math.floor(days))}`);
      const list = Array.isArray(body) ? body : Array.isArray((body as Obj | null)?.items) ? ((body as Obj).items as unknown[]) : [];
      return list.map(toContent).filter((c): c is DataOsContent => !!c);
    },
  };
}
