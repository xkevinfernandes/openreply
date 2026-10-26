import { describe, expect, it, vi } from "vitest";
import { lineOf } from "../../components/os/settings/settings-nav";
import { fixLabel, instagramLine, instagramProblems, mockInstagramState, fixMockWebhook, resetMockConnections } from "../../lib/os/connections";
import {
  diagnosticsStatus,
  fieldsStatus,
  integrationsStatus,
  logsStatus,
  STATUS_PENDING,
  tagsStatus,
  withCap,
  WORKSPACE_STATUS,
} from "../../lib/os/settings";

describe("Settings status lines", () => {
  it("one line per section", () => {
    expect(integrationsStatus(["Zernio", "Kit", "Cal.com"])).toBe("Zernio, Kit, Cal.com connected");
    expect(integrationsStatus([])).toBe("None connected");
    expect(fieldsStatus(3, 7)).toBe("3 built in · 7 custom");
    expect(tagsStatus(8, 5)).toBe("8 tags · 5 system");
    expect(tagsStatus(1, 1)).toBe("1 tag · 1 system");
    expect(logsStatus(12)).toBe("12 messages today");
    expect(logsStatus(1)).toBe("1 message today");
    expect(diagnosticsStatus(0)).toBe("Everything's running");
    expect(diagnosticsStatus(1)).toBe("1 problem");
    expect(diagnosticsStatus(3)).toBe("3 problems");
    expect(WORKSPACE_STATUS).toBe("Timezone, send cap");
  });

  it("a line slower than the 1.5 s cap is null (shown as …), a fast one comes through", async () => {
    vi.useFakeTimers();
    try {
      const slow = withCap(new Promise<string>((r) => setTimeout(() => r("late"), 5000)), 1500);
      const fast = withCap(Promise.resolve("fast"), 1500);
      await vi.advanceTimersByTimeAsync(1500);
      expect(await slow).toBeNull();
      expect(await fast).toBe("fast");
    } finally {
      vi.useRealTimers();
    }
    expect(STATUS_PENDING).toBe("…");
  });

  it("a new server line (after a save) replaces the old one; a slow one takes the fetched line", () => {
    expect(lineOf({ tab: "fields", line: "3 built in · 1 custom" }, { fields: "3 built in · 0 custom" })).toBe("3 built in · 1 custom");
    expect(lineOf({ tab: "fields", line: STATUS_PENDING }, { fields: "3 built in · 0 custom" })).toBe("3 built in · 0 custom");
    expect(lineOf({ tab: "fields", line: STATUS_PENDING }, {})).toBe(STATUS_PENDING);
  });

  it("a failing line is null too (filled client-side)", async () => {
    expect(await withCap(Promise.reject(new Error("db down")), 1500)).toBeNull();
  });
});

const ACC = { username: "claudepreneur", provider: "ZERNIO", tokenExpiresAt: null, zernioAccountId: "z1", webhookSubscribed: true };
const ZOK = { configured: true, webhookReady: true };
const NOW = new Date("2026-10-26T12:00:00Z");

describe("Instagram connection: one source for every screen", () => {
  it("each problem names the fix that clears it", () => {
    expect(instagramProblems(ACC, ZOK, NOW)).toEqual([]);
    expect(instagramProblems({ ...ACC, webhookSubscribed: false }, ZOK, NOW)).toEqual([{ text: "Webhook not subscribed", fix: "webhook" }]);
    expect(instagramProblems(ACC, { configured: false, webhookReady: false }, NOW)[0]).toEqual({ text: "Zernio key missing", fix: "zernio" });
    expect(instagramProblems(ACC, { configured: true, webhookReady: false }, NOW)[0].fix).toBe("zernio");
    expect(instagramProblems({ ...ACC, zernioAccountId: null }, ZOK, NOW)[0]).toEqual({ text: "Not linked in Zernio", fix: "connect" });
    expect(instagramProblems({ ...ACC, provider: "INSTAGRAM", tokenExpiresAt: new Date("2026-10-01") }, ZOK, NOW)[0]).toEqual({ text: "Token expired", fix: "connect" });
    expect(instagramProblems(null, ZOK, NOW)).toEqual([]);
    expect(fixLabel("webhook")).toBe("Fix webhook");
    expect(fixLabel("connect")).toBe("Reconnect");
    expect(fixLabel("zernio")).toBe("Set up Zernio");
  });

  it("the section line", () => {
    expect(instagramLine({ account: null, problems: [] })).toBe("Not connected");
    const acc = { ...ACC, id: "a", automations: 0, connectedAt: null };
    expect(instagramLine({ account: acc, problems: [] })).toBe("@claudepreneur · connected");
    expect(instagramLine({ account: acc, problems: [{ text: "Webhook not subscribed", fix: "webhook" }] })).toBe("@claudepreneur · Webhook not subscribed");
  });

  it("OS_MOCK: @claudepreneur through Zernio, webhook not subscribed until Fix webhook", () => {
    resetMockConnections();
    const before = mockInstagramState(NOW);
    expect(before.account?.username).toBe("claudepreneur");
    expect(before.sample).toBe(true);
    expect(instagramLine(before)).toBe("@claudepreneur · Webhook not subscribed");
    fixMockWebhook();
    expect(instagramLine(mockInstagramState(NOW))).toBe("@claudepreneur · connected");
    resetMockConnections();
  });
});
