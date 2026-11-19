// View-only inboxes (/os/view): a client's DMs Kevin can read and nothing can
// act on. These pin the read-only guarantees: GET only, read paths only, the
// key reachable from one module only, no ZernioConnection / InstagramAccount
// row and no webhook, and pages with no way to send.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetViewLimits, addViewInbox, isAllowedReadPath, VIEW_PAGE_SIZE, viewGet, viewMessages, viewThreads, type ViewInboxRow } from "@/lib/os/view-inbox";
import { ROOT, sourceFiles } from "./source-scan";

const row: ViewInboxRow = { id: "v1", workspaceId: "w1", label: "Luke (view only)", apiKey: "enc:k", zernioAccountId: "acc1", username: "luke" };
const decrypt = (s: string) => s.replace(/^enc:/, "");

beforeEach(() => __resetViewLimits({ sleep: async () => {} }));

function fakeFetch(body: unknown, status = 200) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return vi.fn(async (_url: string, _init: { method: string }) => ({ ok: status < 400, status, json: async () => body }));
}

describe("viewGet", () => {
  it("only ever sends GET, with the key as a bearer", async () => {
    const f = fakeFetch({ data: [] });
    await viewGet("k", "/inbox/conversations?accountId=a", f);
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0][1].method).toBe("GET");
  });

  it("refuses anything but the three read paths, before any request", async () => {
    const f = fakeFetch({});
    for (const p of [
      "/inbox/conversations/c1/messages", // the send path (POST in DM OS)
      "/webhooks/settings",
      "/inbox/conversations/c1/messages/m1",
      "/inbox/conversations/c1",
      "/posts",
      "/comments/x/reply",
      "//evil.example/inbox/conversations?x",
    ]) {
      expect(isAllowedReadPath(p)).toBe(false);
      await expect(viewGet("k", p, f)).rejects.toThrow(/not allowed/);
    }
    expect(f).not.toHaveBeenCalled();
    expect(isAllowedReadPath("/inbox/conversations/c1/messages?accountId=a")).toBe(true);
    expect(isAllowedReadPath("/accounts")).toBe(true);
  });

  it("never surfaces Zernio's error body", async () => {
    const f = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ secret: "leak" }) }));
    await expect(viewGet("k", "/accounts", f)).rejects.toThrow("Zernio read failed (HTTP 403)");
  });

  it("has no method parameter at all", () => {
    expect(viewGet.length).toBe(2); // apiKey, path (fetchFn has a default)
  });
});

describe("reads", () => {
  it("lists threads for the inbox's own account, newest page with a cursor", async () => {
    const f = fakeFetch({
      data: [{ id: "c1", participantUsername: "amy", updatedTime: "2026-11-19T12:00:00Z", lastMessage: "hi", unreadCount: 2 }, { participantUsername: "no id" }],
      pagination: { hasMore: true, nextCursor: "n2" },
    });
    const page = await viewThreads(row, null, { fetchFn: f, decrypt });
    expect(page.rows).toEqual([expect.objectContaining({ conversationId: "c1", username: "amy", preview: "hi", unreadCount: 2 })]);
    expect(page.cursor).toBe("n2");
    expect(f.mock.calls[0][0]).toContain("accountId=acc1");
    expect(f.mock.calls[0][1]).toMatchObject({ method: "GET", headers: { Authorization: "Bearer k" } });
  });

  it("reads one conversation's messages oldest first", async () => {
    const f = fakeFetch({
      messages: [
        { id: "m2", message: "second", direction: "outgoing", createdAt: "2026-11-19T12:01:00Z" },
        { id: "m1", message: "first", direction: "incoming", createdAt: "2026-11-19T12:00:00Z" },
      ],
    });
    const page = await viewMessages(row, "c/1", null, { fetchFn: f, decrypt });
    expect(f.mock.calls[0][0]).toContain("/inbox/conversations/c%2F1/messages?");
    expect(f.mock.calls[0][1].method).toBe("GET");
    expect(page.rows.map((m) => m.id)).toEqual(["m1", "m2"]);
    expect(page.cursor).toBeNull();
  });
});

describe("addViewInbox", () => {
  const db = (existing: { id: string } | null = null) => ({
    workspace: { findUnique: vi.fn(async () => ({ id: "w1" })) },
    instagramAccount: { findFirst: vi.fn(async () => existing) },
    osViewInbox: { upsert: vi.fn(async () => ({ id: "v1" })) },
  });
  const accounts = fakeFetch({ accounts: [{ _id: "acc1", platform: "instagram", username: "luke" }] });

  it("stores the key encrypted, after checking it reaches the account", async () => {
    const d = db();
    const out = await addViewInbox({ workspaceId: "w1", label: "Luke (view only)", zernioAccountId: "acc1", apiKey: "k" }, { db: d, encrypt: (s) => `enc:${s}`, fetchFn: accounts });
    expect(out).toEqual({ id: "v1", username: "luke" });
    const args = (d.osViewInbox.upsert.mock.calls[0] as unknown as [{ create: { apiKey: string } }])[0];
    expect(args.create.apiKey).toBe("enc:k");
  });

  it("refuses an account DM OS can already send from", async () => {
    await expect(
      addViewInbox({ workspaceId: "w1", label: "x", zernioAccountId: "acc1", apiKey: "k" }, { db: db({ id: "ig1" }), encrypt: (s) => s, fetchFn: accounts }),
    ).rejects.toThrow(/already connected/);
  });

  it("refuses a key that doesn't reach the account", async () => {
    await expect(
      addViewInbox({ workspaceId: "w1", label: "x", zernioAccountId: "other", apiKey: "k" }, { db: db(), encrypt: (s) => s, fetchFn: accounts }),
    ).rejects.toThrow(/does not reach/);
  });
});

describe("source guarantees", () => {
  const read = (rel: string) => readFileSync(path.join(ROOT, rel), "utf8");

  it("only the view-inbox module touches OsViewInbox (the key cannot reach any send path)", () => {
    const users = sourceFiles().filter((f) => /osViewInbox|OsViewInbox/.test(read(f)));
    expect(users).toEqual(["lib/os/view-inbox.ts"]);
  });

  it("the module never writes to Zernio and never makes a sending row", () => {
    const src = read("lib/os/view-inbox.ts");
    expect(src).not.toMatch(/zernioRequest/);
    expect(src).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    expect(src).not.toMatch(/zernioConnection\.|instagramAccount\.(create|upsert|update)|\/webhooks/);
  });

  it("the pages have no server action, form or composer", () => {
    for (const f of sourceFiles().filter((f) => f.startsWith("app/(os)/os/view/"))) {
      const src = read(f);
      expect(src).not.toMatch(/"use server"|<form|action=|Composer|actions"/);
      expect(src).not.toMatch(/@\/lib\/os\/(inbox|setter|sending|workflows|voice)\b/);
    }
  });
});

// Zernio limits on a client's free-tier key (60 reads/min): serial, header
// aware, no hot retries, 402 a hard stop, bounded pages, short cache.
describe("Zernio limits", () => {
  const hdrs = (h: Record<string, string>) => ({ get: (n: string) => h[n.toLowerCase()] ?? null });
  const res = (status: number, h: Record<string, string> = {}, body: unknown = { data: [] }) => ({ ok: status < 400, status, headers: hdrs(h), json: async () => body });

  it("runs reads for one key one at a time, never in parallel", async () => {
    let inFlight = 0;
    let peak = 0;
    const f = vi.fn(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      return res(200);
    });
    await Promise.all([1, 2, 3, 4].map((i) => viewGet("k", `/inbox/conversations?accountId=a&n=${i}`, f)));
    expect(f).toHaveBeenCalledTimes(4);
    expect(peak).toBe(1);
  });

  it("caches a page for 60s, so reloads and back/forward spend no reads", async () => {
    let t = 1_000_000;
    __resetViewLimits({ sleep: async () => {}, now: () => t });
    const f = vi.fn(async () => res(200));
    await viewGet("k", "/inbox/conversations?accountId=a", f);
    await viewGet("k", "/inbox/conversations?accountId=a", f);
    expect(f).toHaveBeenCalledTimes(1);
    t += 61_000;
    await viewGet("k", "/inbox/conversations?accountId=a", f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("402 is a hard stop: one request, no retry", async () => {
    const f = vi.fn(async () => res(402));
    await expect(viewGet("k", "/accounts", f)).rejects.toThrow(/402.*not retried/);
    await expect(viewGet("k", "/inbox/conversations?accountId=a", f)).rejects.toThrow(/402/);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("429 blocks the key until Retry-After, with no retry loop", async () => {
    let t = 1_000_000;
    __resetViewLimits({ sleep: async () => {}, now: () => t });
    const f = vi.fn(async () => res(429, { "retry-after": "30" }));
    await expect(viewGet("k", "/inbox/conversations?accountId=a", f)).rejects.toThrow(/try again in 30s/);
    await expect(viewGet("k", "/inbox/conversations?accountId=a&x=2", f)).rejects.toThrow(/try again in 30s/);
    expect(f).toHaveBeenCalledTimes(1);
    t += 31_000;
    f.mockImplementation(async () => res(200));
    await viewGet("k", "/inbox/conversations?accountId=a&x=3", f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("near 0 remaining: waits for a close reset, refuses a far one", async () => {
    const t = 1_000_000;
    const sleeps: number[] = [];
    __resetViewLimits({ sleep: async (ms) => void sleeps.push(ms), now: () => t });
    const f = vi.fn(async () => res(200, { "x-ratelimit-remaining": "1", "x-ratelimit-reset": String((t + 3_000) / 1000) }));
    await viewGet("k", "/inbox/conversations?accountId=a&p=1", f);
    await viewGet("k", "/inbox/conversations?accountId=a&p=2", f);
    expect(sleeps).toEqual([3_000]);
    f.mockImplementation(async () => res(200, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String((t + 40_000) / 1000) }));
    await viewGet("k", "/inbox/conversations?accountId=a&p=3", f);
    const calls = f.mock.calls.length;
    await expect(viewGet("k", "/inbox/conversations?accountId=a&p=4", f)).rejects.toThrow(/try again in 40s/);
    expect(f.mock.calls.length).toBe(calls);
  });

  it("retries a connection reset with backoff, at most 3 attempts", async () => {
    const f = vi.fn(async () => {
      throw new Error("read ECONNRESET");
    });
    await expect(viewGet("k", "/accounts", f)).rejects.toThrow(/tried 3 times/);
    expect(f).toHaveBeenCalledTimes(3);
    const g = vi.fn().mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(res(200, {}, { accounts: [] }));
    await expect(viewGet("k2", "/accounts", g)).resolves.toEqual({ accounts: [] });
    expect(g).toHaveBeenCalledTimes(2);
  });

  it("reads one bounded page per call and never walks the list or other threads", async () => {
    const f = fakeFetch({ data: [{ id: "c1" }], pagination: { hasMore: true, nextCursor: "n2" } });
    const page = await viewThreads(row, null, { fetchFn: f, decrypt });
    expect(f).toHaveBeenCalledTimes(1);
    expect(page.cursor).toBe("n2");
    expect(f.mock.calls[0][0]).toContain(`limit=${VIEW_PAGE_SIZE}`);
    expect(VIEW_PAGE_SIZE).toBeLessThanOrEqual(50);
    const m = fakeFetch({ messages: [], pagination: { hasMore: true, nextCursor: "m2" } });
    await viewMessages(row, "c1", null, { fetchFn: m, decrypt });
    expect(m).toHaveBeenCalledTimes(1);
  });

  it("the view page reads serially (no Promise.all over Zernio reads)", () => {
    const src = readFileSync(path.join(ROOT, "app/(os)/os/view/[id]/page.tsx"), "utf8");
    expect(src).not.toMatch(/Promise\.all\(\[\s*viewThreads/);
  });
});
