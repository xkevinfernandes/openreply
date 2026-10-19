import { describe, expect, it, vi } from "vitest";
import { createHttpDataOs, DataOsError, toContent } from "../../lib/os/dataos/http";
import { MOCK_STORIES, mockDataOs } from "../../lib/os/dataos/mock";

function routes(map: Record<string, { status?: number; json?: unknown }>) {
  const calls: { url: string; auth: string | null }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, auth: (init?.headers as Record<string, string>)?.Authorization ?? null });
    const key = Object.keys(map).find((k) => u.includes(k));
    const r = key ? map[key] : { status: 404 };
    return new Response(JSON.stringify(r.json ?? {}), { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

describe("Data OS http client", () => {
  it("looks up the story a reply points at, with the bearer token", async () => {
    const r = routes({ "/stories/lookup": { json: { story_id: "s9", thumbnail_url: "https://t/9.jpg", caption: "Claude built my setter", topic: "AI setter", posted_at: "2026-10-17T08:00:00Z" } } });
    const os = createHttpDataOs({ baseUrl: "https://data.example.com/api/", token: "tok", fetch: r.fetch });
    const s = await os.storyFor({ storyId: "s9", assetId: "123", at: "2026-10-17T09:00:00Z" });
    expect(s).toEqual({ id: "s9", thumbnailUrl: "https://t/9.jpg", caption: "Claude built my setter", topic: "AI setter", postedAt: "2026-10-17T08:00:00Z", permalink: null });
    expect(r.calls[0].url).toBe("https://data.example.com/api/stories/lookup?storyId=s9&assetId=123&at=2026-10-17T09%3A00%3A00Z");
    expect(r.calls[0].auth).toBe("Bearer tok");
  });

  it("404 is null, other errors throw, status reports instead of throwing", async () => {
    const r = routes({ "/content/by-media/": { status: 404 }, "/stories/recent": { status: 500 }, "/status": { status: 401 } });
    const os = createHttpDataOs({ baseUrl: "https://d.example.com", token: "t", fetch: r.fetch });
    expect(await os.contentByMediaId("m1")).toBeNull();
    await expect(os.recentStories(3)).rejects.toBeInstanceOf(DataOsError);
    expect(await os.status()).toMatchObject({ connected: false, mode: "http", error: "Data OS 401" });
  });

  it("recent stories accept a list or {items}", async () => {
    const r = routes({ "/stories/recent": { json: { items: [{ id: "a", caption: "x" }, { nope: true }] } } });
    const os = createHttpDataOs({ baseUrl: "https://d.example.com", token: "t", fetch: r.fetch });
    expect((await os.recentStories(7)).map((s) => s.id)).toEqual(["a"]);
    expect(r.calls[0].url).toContain("days=7");
  });

  it("skips a lookup with nothing to look up, and rejects non-http urls", async () => {
    const r = routes({});
    const os = createHttpDataOs({ baseUrl: "https://d.example.com", token: "t", fetch: r.fetch });
    expect(await os.storyFor({ storyId: null, assetId: null, at: null })).toBeNull();
    expect(r.calls).toHaveLength(0);
    expect(() => createHttpDataOs({ baseUrl: "ftp://x", token: "t" })).toThrow();
  });

  it("toContent is lenient and needs an id", () => {
    expect(toContent({ mediaId: 5, text: "hi", url: "https://ig/p/1" })).toMatchObject({ id: "5", caption: "hi", permalink: "https://ig/p/1" });
    expect(toContent({ caption: "no id" })).toBeNull();
    expect(toContent(null)).toBeNull();
  });
});

describe("Data OS mock", () => {
  it("serves the board's stories", async () => {
    expect(await mockDataOs.status()).toEqual({ connected: true, mode: "mock" });
    expect((await mockDataOs.storyFor({ storyId: "story-setter", assetId: null, at: null }))?.caption).toBe("Claude built my setter");
    expect((await mockDataOs.recentStories(7)).length).toBe(MOCK_STORIES.length);
  });
});
