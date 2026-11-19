// View-only inboxes (/os/view): a client's DMs Kevin can read and nothing can
// act on. These pin the read-only guarantees: GET only, read paths only, the
// key reachable from one module only, no ZernioConnection / InstagramAccount
// row and no webhook, and pages with no way to send.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { addViewInbox, isAllowedReadPath, viewGet, viewMessages, viewThreads, type ViewInboxRow } from "@/lib/os/view-inbox";
import { ROOT, sourceFiles } from "./source-scan";

const row: ViewInboxRow = { id: "v1", workspaceId: "w1", label: "Luke (view only)", apiKey: "enc:k", zernioAccountId: "acc1", username: "luke" };
const decrypt = (s: string) => s.replace(/^enc:/, "");

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
