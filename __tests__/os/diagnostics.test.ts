import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calcomCheck,
  CHECK_KEYS,
  checkedLabel,
  diagnosticsSummary,
  instagramCheck,
  kitCheck,
  parseOnly,
  queueCheck,
  runCheck,
  webhookCheck,
  workerCheck,
  zernioCheck,
} from "../../lib/os/diagnostics";

const now = new Date("2026-10-26T12:00:00Z");
const ROOT = path.resolve(__dirname, "../..");

describe("Diagnostics checks", () => {
  it("Instagram account: tone, line and Reconnect", () => {
    const ok = instagramCheck({ account: { username: "claude", provider: "INSTAGRAM", tokenExpiresAt: new Date("2026-12-21T00:00:00Z"), zernioAccountId: null }, zernioReady: false, now });
    expect(ok.tone).toBe("good");
    expect(ok.line).toBe("@claude · token valid until 21 Dec");
    const expired = instagramCheck({ account: { username: "claude", provider: "INSTAGRAM", tokenExpiresAt: new Date("2026-10-01T00:00:00Z"), zernioAccountId: null }, zernioReady: false, now });
    expect(expired.tone).toBe("bad");
    expect(expired.next[0]).toEqual({ label: "Reconnect", href: "/os/settings?tab=instagram", fix: "connect" });
    // Zernio not set up: the step opens the Zernio key form, not a reconnect.
    expect(instagramCheck({ account: { username: "c", provider: "ZERNIO", tokenExpiresAt: null, zernioAccountId: "z" }, zernioReady: false, now }).next[0].fix).toBe("zernio");
    expect(instagramCheck({ account: null, zernioReady: false, now }).tone).toBe("bad");
    expect(instagramCheck({ account: { username: "c", provider: "ZERNIO", tokenExpiresAt: null, zernioAccountId: "z" }, zernioReady: true, now }).tone).toBe("good");
  });

  it("webhook", () => {
    expect(webhookCheck({ connected: true, subscribed: false, failedToday: 0 })).toMatchObject({ tone: "bad", line: "Not subscribed, so new DMs and comments don't arrive" });
    // The step fixes the webhook, not a generic reconnect.
    expect(webhookCheck({ connected: true, subscribed: false, failedToday: 0 }).next[0]).toMatchObject({ label: "Fix webhook", fix: "webhook" });
    expect(webhookCheck({ connected: true, subscribed: true, failedToday: 2 }).tone).toBe("warn");
    expect(webhookCheck({ connected: false, subscribed: false, failedToday: 0 }).tone).toBe("off");
  });

  it("queue: latency and counts; local Redis refused is off, not a problem", () => {
    expect(queueCheck({ ok: true, latencyMs: 40.2, counts: {} })).toMatchObject({ tone: "good", line: "Answered in 40 ms" });
    expect(queueCheck({ ok: true, latencyMs: 12, counts: { failed: 3 } }).tone).toBe("warn");
    expect(queueCheck({ ok: false, local: true })).toMatchObject({ tone: "off", line: "Redis isn't running locally" });
    expect(queueCheck({ ok: false, local: false }).tone).toBe("bad");
  });

  it("worker: down names the time and the fix (Railway, or npm run worker locally)", () => {
    const at = new Date(2026, 9, 26, 10, 42);
    const down = workerCheck({ ok: true, healthy: false, checkedAt: at, ageMs: 9e6, failedToday: 0, local: false, restartUrl: "https://railway.app/x" });
    expect(down.tone).toBe("bad");
    expect(down.line).toBe("Hasn't checked in since 10:42 · DMs wait in the queue until it's back");
    expect(down.next.map((n) => n.label)).toEqual(["Restart the worker on Railway", "Open DM logs"]);
    expect(down.next[0].href).toBe("https://railway.app/x");
    const local = workerCheck({ ok: true, healthy: false, checkedAt: null, ageMs: null, failedToday: 0, local: true });
    expect(local.next[0].label).toBe("Start it with `npm run worker`");
    expect(workerCheck({ ok: true, healthy: true, checkedAt: at, ageMs: 120_000, failedToday: 0, local: true })).toMatchObject({ tone: "good", line: "Last ran 2 min ago · 0 failed jobs today" });
    expect(workerCheck({ ok: false, local: true }).tone).toBe("off");
  });

  it("Zernio, Kit and Cal.com: not connected is grey off", () => {
    expect(zernioCheck({ configured: false, webhookReady: false, used: false }).tone).toBe("off");
    expect(zernioCheck({ configured: false, webhookReady: false, used: true }).tone).toBe("bad");
    expect(zernioCheck({ configured: true, webhookReady: true, used: true }).line).toBe("Connected · inbox access");
    expect(kitCheck({ connected: false, lastSyncedAt: null, errors: 0, lastError: null }).tone).toBe("off");
    expect(kitCheck({ connected: true, lastSyncedAt: null, errors: 0, lastError: null })).toMatchObject({ tone: "good", line: "Nothing synced yet · 0 errors" });
    expect(kitCheck({ connected: true, lastSyncedAt: now, errors: 0, lastError: "The Kit API key is invalid." }).next[0].label).toBe("Replace key");
    expect(kitCheck({ connected: true, lastSyncedAt: now, errors: 2, lastError: null }).tone).toBe("warn");
    expect(calcomCheck({ connected: false, lastError: null, lastBookingAt: null }).tone).toBe("off");
    expect(calcomCheck({ connected: true, lastError: null, lastBookingAt: new Date("2026-10-21T10:00:00Z") }).line).toBe("Bookings arriving · last 21 Oct");
  });

  it("a check that doesn't answer in 3 s is a warn of its own", async () => {
    vi.useFakeTimers();
    try {
      const late = runCheck("kit", () => new Promise(() => undefined));
      await vi.advanceTimersByTimeAsync(3000);
      expect(await late).toMatchObject({ key: "kit", tone: "warn", line: "Didn't answer in 3 s" });
    } finally {
      vi.useRealTimers();
    }
    expect((await runCheck("kit", () => Promise.reject(new Error("boom")))).tone).toBe("bad");
  });

  it("the verdict counts bad rows only", () => {
    expect(diagnosticsSummary([{ tone: "good" }, { tone: "off" }])).toMatchObject({ problems: 0, text: "Everything's running", tone: "good" });
    expect(diagnosticsSummary([{ tone: "bad" }, { tone: "warn" }])).toMatchObject({ problems: 1, text: "1 problem", tone: "bad" });
    expect(diagnosticsSummary([{ tone: "warn" }]).tone).toBe("warn");
    expect(checkedLabel(Date.now(), Date.now() + 5000)).toBe("Checked just now");
    expect(checkedLabel(null, 0)).toBe("Checking…");
  });

  it("?only= runs just its keys (token = the Instagram account)", () => {
    expect(parseOnly("worker,webhook,token")).toEqual(["worker", "webhook", "instagram"]);
    expect(parseOnly(null)).toEqual([...CHECK_KEYS]);
    expect(parseOnly("nope")).toEqual([...CHECK_KEYS]);
  });
});

describe("Diagnostics reads", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("both diagnostics routes call the one shared reads function", () => {
    const admin = readFileSync(path.join(ROOT, "app/api/admin/diagnostics/route.ts"), "utf8");
    const os = readFileSync(path.join(ROOT, "app/api/os/diagnostics/route.ts"), "utf8");
    expect(admin).toMatch(/diagnosticsDetails\(workspaceId\)/);
    expect(os).toMatch(/diagnosticsDetails\(context\.workspaceId\)/);
    // The reads aren't duplicated in the admin route any more.
    expect(admin).not.toMatch(/prisma\./);
  });

  it("mock mode reads nothing and calls nothing outside (sample rows)", async () => {
    vi.stubEnv("OS_MOCK", "1");
    vi.stubEnv("NODE_ENV", "test");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { readChecks } = await import("../../lib/os/diagnostics-reads");
    const rows = await readChecks("ws-1", ["worker", "webhook", "instagram"]);
    expect(rows.map((r) => r.key)).toEqual(["worker", "webhook", "instagram"]);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("mock mode: the rows match the one connection source (and Fix webhook clears it)", async () => {
    vi.stubEnv("OS_MOCK", "1");
    vi.stubEnv("NODE_ENV", "test");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const conn = await import("../../lib/os/connections");
    conn.resetMockConnections();
    const { readChecks, mockDetails } = await import("../../lib/os/diagnostics-reads");
    const rows = await readChecks("ws-1", ["instagram", "webhook", "queue", "worker", "zernio"]);
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.instagram.line).toBe("@claudepreneur · connected through Zernio");
    expect(by.webhook.tone).toBe("bad");
    expect(conn.instagramLine(await conn.readInstagram("ws-1"))).toBe("@claudepreneur · Webhook not subscribed");
    expect(by.queue.line).toBe("Answered in 40 ms");
    // The details the row's queue promises are there too (no "didn't answer").
    expect(mockDetails().queueCounts).toEqual({ waiting: 0, active: 0, delayed: 0, failed: 0 });
    expect(by.zernio.tone).toBe("good");
    conn.fixMockWebhook();
    expect((await readChecks("ws-1", ["webhook"]))[0].tone).toBe("good");
    expect(conn.instagramLine(await conn.readInstagram("ws-1"))).toBe("@claudepreneur · connected");
    conn.resetMockConnections();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("Details after a plain check still come back (the cache keeps them apart)", async () => {
    vi.stubEnv("OS_MOCK", "1");
    vi.stubEnv("NODE_ENV", "test");
    vi.doMock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: async () => ({ workspaceId: "ws-details", role: "OWNER" }) }));
    const { GET } = await import("../../app/api/os/diagnostics/route");
    await GET(new Request("http://localhost/api/os/diagnostics?only=queue&fresh=1"));
    const body = await (await GET(new Request("http://localhost/api/os/diagnostics?only=queue&details=1"))).json();
    expect(body.data.details.queueCounts).toEqual({ waiting: 0, active: 0, delayed: 0, failed: 0 });
    vi.doUnmock("@/lib/workspace-access");
  });

  it("the OS route refuses a caller with no workspace", async () => {
    vi.doMock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: async () => null }));
    const { GET } = await import("../../app/api/os/diagnostics/route");
    const res = await GET(new Request("http://localhost/api/os/diagnostics"));
    expect(res.status).toBe(401);
    vi.doUnmock("@/lib/workspace-access");
  });

  it("the OS route only reads the caller's own workspace", async () => {
    vi.stubEnv("OS_MOCK", "1");
    vi.stubEnv("NODE_ENV", "test");
    const seen: string[] = [];
    vi.doMock("@/lib/workspace-access", () => ({ getCurrentWorkspaceContext: async () => ({ workspaceId: "ws-mine", role: "OWNER" }) }));
    vi.doMock("@/lib/os/diagnostics-reads", async (orig) => {
      const real = (await orig()) as typeof import("../../lib/os/diagnostics-reads");
      return { ...real, readChecks: async (ws: string, keys: Parameters<typeof real.readChecks>[1]) => (seen.push(ws), real.readChecks(ws, keys)), sendingToday: async (ws: string) => (seen.push(ws), { sent: 1, cap: 80 }) };
    });
    const { GET } = await import("../../app/api/os/diagnostics/route");
    const body = await (await GET(new Request("http://localhost/api/os/diagnostics?only=worker,webhook,token"))).json();
    expect(body.data.checks.map((c: { key: string }) => c.key)).toEqual(["worker", "webhook", "instagram"]);
    expect(new Set(seen)).toEqual(new Set(["ws-mine"]));
    vi.doUnmock("@/lib/workspace-access");
    vi.doUnmock("@/lib/os/diagnostics-reads");
  });
});
