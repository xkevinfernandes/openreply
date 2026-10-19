import { describe, expect, it } from "vitest";
import { mockDataOs } from "../../lib/os/dataos/mock";
import { createDescriber } from "../../lib/os/media/describe";
import type { MediaItem } from "../../lib/os/media/detect";
import { enrichOne, ensureEnriched, ExpiredMediaError, memoryMediaStore, MAX_ATTEMPTS, type EnrichDeps, type EnrichTarget } from "../../lib/os/media/enrich";
import { refreshPath } from "../../lib/os/media/jobs";
import { createTranscriber, FAKE_TRANSCRIPT, type Transcriber } from "../../lib/os/media/transcribe";

const item = (over: Partial<MediaItem> = {}): MediaItem => ({
  messageId: "v1",
  direction: "incoming",
  kind: "voice",
  sourceUrl: "https://cdn/v1",
  caption: null,
  mediaId: null,
  shareKind: null,
  story: null,
  refreshUrl: "https://zernio.com/api/v1/inbox/conversations/c/messages/v1",
  at: "2026-10-19T10:00:00Z",
  ...over,
});

const target = (over: Partial<EnrichTarget> = {}): EnrichTarget => ({ workspaceId: "w1", conversationId: "c", contactId: "ct1", kind: "SALES", ...over });

function deps(over: Partial<EnrichDeps> = {}) {
  const store = memoryMediaStore();
  let downloads = 0;
  let calls = 0;
  const transcriber: Transcriber = {
    name: "fake",
    transcribe: async () => {
      calls++;
      return FAKE_TRANSCRIPT;
    },
  };
  const d: EnrichDeps = {
    store,
    transcriber,
    describer: createDescriber("fake"),
    dataOs: mockDataOs,
    download: async () => {
      downloads++;
      return { bytes: new Uint8Array([1]), contentType: "audio/mp4" };
    },
    refresh: async () => null,
    ...over,
  };
  return { d, store, downloads: () => downloads, calls: () => calls };
}

describe("enrichOne", () => {
  it("transcribes a voice note and is idempotent", async () => {
    const { d, store, calls, downloads } = deps();
    const r = await enrichOne(d, target(), item());
    expect(r).toMatchObject({ status: "done", transcript: FAKE_TRANSCRIPT, provider: "fake", attempts: 1 });
    const again = await enrichOne(d, target(), item());
    expect(again.status).toBe("done");
    expect(calls()).toBe(1);
    expect(downloads()).toBe(1);
    expect(store.rows.size).toBe(1);
  });

  it("describes an image", async () => {
    const { d } = deps();
    const r = await enrichOne(d, target(), item({ messageId: "i1", kind: "image" }));
    expect(r.status).toBe("done");
    expect(r.description).toMatch(/screenshot/);
  });

  it("refreshes an expired url through Zernio's refreshUrl", async () => {
    const seen: string[] = [];
    const { d } = deps({
      download: async (url) => {
        seen.push(url);
        if (url === "https://cdn/v1") throw new ExpiredMediaError(403);
        return { bytes: new Uint8Array([1]), contentType: "audio/mp4" };
      },
      refresh: async () => "https://cdn/v1-fresh",
    });
    const r = await enrichOne(d, target(), item());
    expect(seen).toEqual(["https://cdn/v1", "https://cdn/v1-fresh"]);
    expect(r).toMatchObject({ status: "done", sourceUrl: "https://cdn/v1-fresh" });
  });

  it("marks it expired when the refresh can't help, and never retries", async () => {
    const { d, calls } = deps({
      download: async () => {
        throw new ExpiredMediaError(404);
      },
    });
    const r = await enrichOne(d, target(), item());
    expect(r.status).toBe("expired");
    expect((await enrichOne(d, target(), item())).status).toBe("expired");
    expect(calls()).toBe(0);
  });

  it("skips Personal and Pitches threads at no cost", async () => {
    const { d, calls, downloads } = deps();
    expect((await enrichOne(d, target({ kind: "PERSONAL" }), item())).status).toBe("skipped");
    expect((await enrichOne(d, target({ kind: "PITCHES" }), item({ messageId: "v2" }))).status).toBe("skipped");
    expect(calls()).toBe(0);
    expect(downloads()).toBe(0);
    expect((await enrichOne(d, target({ kind: "UNSORTED" }), item({ messageId: "v3" }))).status).toBe("done");
  });

  it("stops at the daily maximum and leaves it pending", async () => {
    const { d, calls } = deps({ dailyMax: 1 });
    await enrichOne(d, target(), item());
    const r = await enrichOne(d, target(), item({ messageId: "v2" }));
    expect(r).toMatchObject({ status: "pending", error: "daily media limit reached" });
    expect(calls()).toBe(1);
  });

  it("retries a failure up to MAX_ATTEMPTS", async () => {
    let n = 0;
    const { d } = deps({
      transcriber: {
        name: "openai",
        transcribe: async () => {
          n++;
          throw new Error("boom");
        },
      },
    });
    for (let i = 0; i < MAX_ATTEMPTS + 2; i++) await enrichOne(d, target(), item());
    expect(n).toBe(MAX_ATTEMPTS);
    const row = (await d.store.get("w1", ["v1"])).get("v1")!;
    expect(row).toMatchObject({ status: "failed", attempts: MAX_ATTEMPTS, error: "boom" });
  });

  it("without a provider key (production) it skips instead of faking", async () => {
    const { d } = deps({ transcriber: null });
    expect((await enrichOne(d, target(), item())).status).toBe("skipped");
  });

  it("story replies get the story card from Data OS, shares keep their caption", async () => {
    const { d, downloads } = deps();
    const s = await enrichOne(d, target(), item({ messageId: "s1", kind: "story_reply", story: { storyId: "story-setter", assetId: null, at: null } }));
    expect(s).toMatchObject({ status: "done", provider: "dataos" });
    expect(s.story?.caption).toBe("Claude built my setter");
    const sh = await enrichOne(d, target(), item({ messageId: "r1", kind: "share", caption: "a reel", mediaId: "unknown", shareKind: "reel" }));
    expect(sh).toMatchObject({ status: "done", caption: "a reel", story: null, provider: "payload" });
    expect(downloads()).toBe(0);
  });

  it("our own voice notes are not re-transcribed", async () => {
    const { d, calls } = deps();
    expect((await enrichOne(d, target(), item({ direction: "outgoing" }))).status).toBe("skipped");
    expect(calls()).toBe(0);
  });
});

describe("ensureEnriched", () => {
  it("returns what finished within the budget; the rest saves later", async () => {
    let release: () => void = () => {};
    const slow = new Promise<void>((r) => (release = r));
    const { d, store } = deps({
      transcriber: {
        name: "fake",
        transcribe: async () => {
          await slow;
          return "late";
        },
      },
    });
    const rows = await ensureEnriched(d, target(), [item({ messageId: "i1", kind: "image" }), item()], { budgetMs: 30, concurrency: 2 });
    expect(rows.get("i1")?.status).toBe("done");
    expect(rows.get("v1")).toBeUndefined();
    release();
    await new Promise((r) => setTimeout(r, 10));
    expect(store.rows.get("v1")?.transcript).toBe("late");
  });

  it("does no work when everything is final", async () => {
    const { d, calls } = deps();
    await ensureEnriched(d, target(), [item()]);
    await ensureEnriched(d, target(), [item()]);
    expect(calls()).toBe(1);
  });

  it("works with the real fake transcriber too", async () => {
    const { d } = deps({ transcriber: createTranscriber("fake") });
    const rows = await ensureEnriched(d, target(), [item()]);
    expect(rows.get("v1")?.transcript).toBe(FAKE_TRANSCRIPT);
  });
});

describe("refreshPath", () => {
  it("reads Zernio's absolute refreshUrl, or builds one", () => {
    expect(refreshPath("https://zernio.com/api/v1/inbox/conversations/A/messages/B", "x", "y")).toBe("/inbox/conversations/A/messages/B");
    expect(refreshPath(null, "c 1", "m:1")).toBe("/inbox/conversations/c%201/messages/m%3A1");
  });
});
