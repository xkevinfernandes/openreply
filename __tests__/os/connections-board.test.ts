// Settings › Connections: no secret ever reaches the page, health checks are
// read-only, the audit log has no secret in it, and disconnect cleans up at
// the provider (calendar webhooks, the Instagram webhook subscription).
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY = "ab".repeat(32);

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const table = (n: string) => (db[n] ??= []);
const matches = (r: Row, where: Row = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "workspaceId_service") return r.workspaceId === (v as Row).workspaceId && r.service === (v as Row).service;
    if (k === "workspaceId_provider") return r.workspaceId === (v as Row).workspaceId && r.provider === (v as Row).provider;
    if (v && typeof v === "object" && !(v instanceof Date) && "in" in (v as Row)) return ((v as { in: unknown[] }).in).includes(r[k]);
    return r[k] === v;
  });
function model(n: string) {
  return {
    findMany: async ({ where }: { where?: Row } = {}) => table(n).filter((r) => matches(r, where)),
    findFirst: async ({ where }: { where?: Row } = {}) => table(n).find((r) => matches(r, where)) ?? null,
    findUnique: async ({ where }: { where: Row }) => table(n).find((r) => matches(r, where)) ?? null,
    create: async ({ data }: { data: Row }) => {
      const row = { id: `id${table(n).length + 1}`, at: new Date(), ...data };
      table(n).push(row);
      return row;
    },
    upsert: async ({ where, create, update }: { where: Row; create: Row; update: Row }) => {
      const row = table(n).find((r) => matches(r, where));
      if (row) return Object.assign(row, update);
      table(n).push({ ...create });
      return create;
    },
    deleteMany: async ({ where }: { where: Row }) => {
      const before = table(n).length;
      db[n] = table(n).filter((r) => !matches(r, where));
      return { count: before - db[n].length };
    },
    updateMany: async () => ({ count: 0 }),
    groupBy: async () => [],
  };
}
vi.mock("@/lib/db/client", () => ({
  prisma: new Proxy({}, { get: (_t, name: string) => model(name) }),
}));

const calls: { url: string; method: string }[] = [];
let calResponses: Record<string, unknown> = {};
vi.mock("@/lib/os/integrations/calendar/http", () => ({
  calFetch: async (_p: string, url: string, init: { method?: string } = {}) => {
    calls.push({ url, method: init.method ?? "GET" });
    return calResponses[`${init.method ?? "GET"} ${url}`] ?? {};
  },
}));

import { encryptToken } from "@/lib/meta/oauth";
import { recordCheck, recordConnect, recordDisconnect } from "@/lib/os/conn/audit";
import { cleanNote, last4, SERVICES } from "@/lib/os/conn/catalog";
import { checkManaged, managedPresence } from "@/lib/os/conn/health";
import { disconnectInstagram } from "@/lib/os/conn/instagram";
import { loadServiceStates } from "@/lib/os/conn/load";
import { buildConnections } from "@/lib/os/conn/view";
import { unregisterCalendarWebhook, webhookUrl } from "@/lib/os/sequences/calendar-sync";

const WS = "ws1";
const SECRETS = {
  kit: "Qx7Vb2Nw9Kp4Rt6Ym3Hc8Jd5wxyz",
  zernio: "Zq4Wn8Vx2Bt6Ky9Pm3Hr7Lc5QRST",
  ghl: "pit-8f3Q-2Lx9-Vw7K-4Nb6Hj3LMNO",
  cal: "Cv5Gx8Tq2Wn7Bk4Rz9Mp6Hd3CALK",
  ig: "IGq7Wx3Vn9Bt2Kp6Rm8Zc4Hj5XYZW",
};
const FORBIDDEN_KEYS = /^(secret|token|key|apiKey|accessToken|webhookSecret|credentials|password)$/i;

function scan(value: unknown, path = "$"): string[] {
  const bad: string[] = [];
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.test(k)) bad.push(`${path}.${k}`);
      bad.push(...scan(v, `${path}.${k}`));
    }
  } else if (typeof value === "string") {
    for (const s of Object.values(SECRETS)) {
      // Any run of 5+ characters of a stored secret is a leak; the last 4 are allowed.
      for (let i = 0; i + 5 <= s.length; i++) if (value.includes(s.slice(i, i + 5))) bad.push(`${path} contains part of a secret`);
    }
  }
  return bad;
}

function seed() {
  for (const k of Object.keys(db)) delete db[k];
  table("crmConnection").push({ workspaceId: WS, provider: "KIT", apiKey: encryptToken(SECRETS.kit) });
  table("zernioConnection").push({ workspaceId: WS, apiKey: encryptToken(SECRETS.zernio), profileId: "p1", webhookId: "w1", webhookSecret: encryptToken("whsec") });
  table("osIntegration").push(
    { workspaceId: WS, provider: "ghl", credentials: encryptToken(JSON.stringify({ token: SECRETS.ghl })) },
    { workspaceId: WS, provider: "calcom", credentials: encryptToken(JSON.stringify({ token: SECRETS.cal })) }
  );
  table("user").push({ id: "u1", name: "Kevin", email: "kevin@example.com" });
}

const input = {
  instagram: {
    account: { id: "a1", username: "claudepreneur", provider: "META", tokenExpiresAt: null, zernioAccountId: null, webhookSubscribed: true, automations: 2, connectedAt: new Date("2026-11-01") },
    zernio: { configured: true, webhookReady: true },
    problems: [],
    sample: false,
  },
  views: [
    { provider: "kit" as const, connected: true, enabled: true, mapping: {} as never, locationId: null, lastTestedAt: null, lastError: null, synced: 3, failing: 0, lastSyncedAt: new Date().toISOString(), errors: [] },
    { provider: "ghl" as const, connected: true, enabled: false, mapping: {} as never, locationId: "loc_12345678", lastTestedAt: null, lastError: null, synced: 0, failing: 0, lastSyncedAt: null, errors: [] },
  ],
  calendars: {
    calendars: [
      { provider: "calcom" as const, connected: true, enabled: true, settings: { accountName: "Kevin F" } as never, lastTestedAt: null, lastError: null, booked: 1, upcoming: 0, webhook: { ready: true, url: "x" } },
      { provider: "calendly" as const, connected: false, enabled: false, settings: {} as never, lastTestedAt: null, lastError: null, booked: 0, upcoming: 0, webhook: { ready: false, url: "x" } },
    ],
    setters: [],
    sample: false,
  },
  dataos: { connected: false, baseUrl: null, enabled: false, lastTestedAt: null, lastError: null, mode: "none" as const },
};

describe("connections view model", () => {
  beforeEach(seed);

  it("serialises with no secret field and no part of a stored secret beyond the last four", async () => {
    await recordConnect(WS, "kit", { actorId: "u1", account: `key ${SECRETS.kit}` });
    await recordCheck(WS, "calcom", { ok: false, error: `401 token=${SECRETS.cal} rejected` });
    const out = buildConnections(await loadServiceStates(WS, input), new Date());
    expect(out.map((c) => c.id)).toEqual(SERVICES.map((s) => s.id));
    expect(scan(JSON.parse(JSON.stringify(out)))).toEqual([]);
    const kit = out.find((c) => c.id === "kit")!;
    expect(kit.last4).toBe(SECRETS.kit.slice(-4));
    expect(kit.connectedBy).toBe("Kevin");
    expect(kit.shared).toBe(true);
    expect(out.find((c) => c.id === "zernio")!.last4).toBe("QRST");
    expect(out.find((c) => c.id === "ghl")!.last4).toBe("LMNO");
  });

  it("maps status: failed check is red, paused is a look, nothing saved is not connected", async () => {
    await recordCheck(WS, "calcom", { ok: false, error: "Cal.com rejected the key" });
    const out = buildConnections(await loadServiceStates(WS, input), new Date());
    const by = (id: string) => out.find((c) => c.id === id)!;
    expect(by("calcom").status).toBe("error");
    expect(by("calcom").problem).toBe("Cal.com rejected the key");
    expect(by("ghl").status).toBe("attention");
    expect(by("calendly").status).toBe("available");
    expect(by("instagram").status).toBe("connected");
    expect(by("instagram").connectedAs).toBe("@claudepreneur");
    expect(by("instagram").scopes.map((s) => s.detail).join(" ")).toContain("instagram_business_manage_messages");
  });

  it("managed services are keyed off presence only", () => {
    expect(managedPresence({ OPENAI_API_KEY: "x" })).toMatchObject({ openai: true, anthropic: false, email: false });
    const out = buildConnections([], new Date());
    expect(out.filter((c) => c.method === "managed").every((c) => c.status === "available")).toBe(true);
  });
});

describe("notes and keys", () => {
  it("cleanNote hides anything token-shaped", () => {
    const n = cleanNote(`Bearer ${SECRETS.zernio} failed; api key=${SECRETS.kit}`)!;
    expect(scan(n)).toEqual([]);
    expect(cleanNote(null)).toBeNull();
  });
  it("last4 never returns more than four, and nothing for short values", () => {
    expect(last4(SECRETS.cal)).toBe("CALK");
    expect(last4("abc")).toBeUndefined();
  });
});

describe("health checks are read-only", () => {
  it("call GET endpoints with the server key and never echo it", async () => {
    const seen: { url: string; method?: string }[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: init?.method });
      return new Response(JSON.stringify({}), { status: url.includes("openai") ? 401 : 200 });
    }) as unknown as typeof fetch;
    const env = { ANTHROPIC_API_KEY: "sk-ant-abcdefghijklmnopqrstu", OPENROUTER_API_KEY: "sk-or-abcdefghijklmnopqrst", OPENAI_API_KEY: "sk-openai-abcdefghijklmnopq" };
    expect(await checkManaged("anthropic", env, fake)).toEqual({ ok: true });
    expect(await checkManaged("openrouter", env, fake)).toEqual({ ok: true });
    const bad = await checkManaged("openai", env, fake);
    expect(bad.ok).toBe(false);
    expect(JSON.stringify(bad)).not.toContain("abcdef");
    expect(seen.every((s) => s.method === undefined)).toBe(true);
    expect(seen.map((s) => new URL(s.url).pathname)).toEqual(["/v1/models", "/api/v1/key", "/v1/models"]);
  });
  it("a missing key is absent, not an error; a sending-only Resend key is valid", async () => {
    expect(await checkManaged("openai", {}, fetch)).toEqual({ ok: false, absent: true });
    const restricted = (async () => new Response(JSON.stringify({ name: "restricted_api_key" }), { status: 401 })) as unknown as typeof fetch;
    expect((await checkManaged("email", { RESEND_API_KEY: "re_abcdefghijklmnop" }, restricted)).ok).toBe(true);
  });
});

describe("audit", () => {
  beforeEach(seed);
  it("records who connected and logs connect / fail / disconnect / revoke_failed without secrets", async () => {
    await recordConnect(WS, "ghl", { actorId: "u1", account: "Location …5678" });
    expect(table("osConnection")[0]).toMatchObject({ service: "ghl", connectedById: "u1", lastError: null });
    await recordCheck(WS, "ghl", { ok: false, error: `GHL said 401 for ${SECRETS.ghl}` }, { actorId: "u1" });
    await recordDisconnect(WS, "ghl", { actorId: "u1", revokeError: `refused ${SECRETS.ghl}` });
    expect(table("osConnectionEvent").map((e) => e.kind)).toEqual(["connect", "fail", "revoke_failed", "disconnect"]);
    expect(scan(table("osConnectionEvent"))).toEqual([]);
    expect(table("osConnection")).toHaveLength(0);
  });
  it("logs automatic checks only when they fail", async () => {
    await recordCheck(WS, "kit", { ok: true });
    await recordCheck(WS, "kit", { ok: true }, { manual: true });
    expect(table("osConnectionEvent").map((e) => e.kind)).toEqual(["check"]);
  });
});

describe("disconnect cleans up at the provider", () => {
  beforeEach(() => {
    seed();
    calls.length = 0;
  });

  it("Cal.com: deletes only the webhook pointing at us", async () => {
    const ours = webhookUrl(WS, "calcom");
    calResponses = { "GET https://api.cal.com/v2/webhooks": { data: [{ id: 7, subscriberUrl: ours }, { id: 8, subscriberUrl: "https://other.example/hook" }] } };
    const r = await unregisterCalendarWebhook(WS, "calcom", encryptToken(JSON.stringify({ token: SECRETS.cal })));
    expect(r.removed).toBe(1);
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["https://api.cal.com/v2/webhooks/7"]);
  });

  it("Calendly: deletes our subscription", async () => {
    const ours = webhookUrl(WS, "calendly");
    const q = new URLSearchParams({ organization: "org1", user: "user1", scope: "user" });
    calResponses = {
      "GET https://api.calendly.com/users/me": { resource: { uri: "user1", current_organization: "org1" } },
      [`GET https://api.calendly.com/webhook_subscriptions?${q}`]: { collection: [{ uri: "https://api.calendly.com/webhook_subscriptions/s1", callback_url: ours }] },
    };
    const r = await unregisterCalendarWebhook(WS, "calendly", encryptToken(JSON.stringify({ token: SECRETS.cal })));
    expect(r.removed).toBe(1);
    expect(calls.at(-1)).toEqual({ url: "https://api.calendly.com/webhook_subscriptions/s1", method: "DELETE" });
  });

  it("no token: nothing to call", async () => {
    expect(await unregisterCalendarWebhook(WS, "calcom", null)).toEqual({ removed: 0 });
    expect(calls).toHaveLength(0);
  });

  it("Instagram (own Meta app): unsubscribes the webhook with the stored token, then deletes it", async () => {
    table("instagramAccount").push(
      { id: "a1", workspaceId: WS, instagramId: "1789", provider: "META", accessToken: encryptToken(SECRETS.ig), username: "claudepreneur" },
      { id: "a2", workspaceId: WS, instagramId: "1790", provider: "ZERNIO", accessToken: "", username: "other" }
    );
    const unsub = vi.fn(async () => ({ success: true }));
    const r = await disconnectInstagram(WS, { actorId: "u1", unsubscribe: unsub });
    expect(unsub).toHaveBeenCalledTimes(1);
    expect(unsub).toHaveBeenCalledWith("1789", SECRETS.ig);
    expect(r).toEqual({ removed: 2, revokeError: null });
    expect(table("instagramAccount")).toHaveLength(0);
    expect(table("osConnectionEvent").map((e) => e.kind)).toEqual(["disconnect"]);
  });

  it("Instagram: a refused unsubscribe still deletes the token and is logged as revoke_failed", async () => {
    table("instagramAccount").push({ id: "a1", workspaceId: WS, instagramId: "1789", provider: "META", accessToken: encryptToken(SECRETS.ig), username: "claudepreneur" });
    const r = await disconnectInstagram(WS, { accountId: "a1", unsubscribe: async () => Promise.reject(new Error(`Invalid OAuth access token ${SECRETS.ig}`)) });
    expect(r.removed).toBe(1);
    expect(r.revokeError).toBeTruthy();
    expect(scan(r)).toEqual([]);
    expect(table("osConnectionEvent").map((e) => e.kind)).toEqual(["revoke_failed", "disconnect"]);
  });
});
