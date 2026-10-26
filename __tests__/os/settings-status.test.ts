import { describe, expect, it, vi } from "vitest";
import {
  diagnosticsStatus,
  fieldsStatus,
  instagramStatus,
  integrationsStatus,
  logsStatus,
  reconnectKind,
  STATUS_PENDING,
  tagsStatus,
  withCap,
  WORKSPACE_STATUS,
} from "../../lib/os/settings";

describe("Settings status lines", () => {
  it("one line per section", () => {
    expect(instagramStatus({ username: "claudepreneur", problem: null })).toBe("@claudepreneur · connected");
    expect(instagramStatus({ username: "claudepreneur", problem: "Instagram webhook isn't subscribed" })).toBe("Instagram webhook isn't subscribed");
    expect(instagramStatus({ username: null, problem: null })).toBe("Not connected");
    expect(integrationsStatus(["Zernio", "Kit", "Cal.com"])).toBe("Zernio, Kit, Cal.com");
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

  it("a failing line is null too (filled client-side)", async () => {
    expect(await withCap(Promise.reject(new Error("db down")), 1500)).toBeNull();
  });
});

describe("Instagram › Reconnect", () => {
  it("token or link problems use Zernio's connect flow", () => {
    expect(reconnectKind(["Instagram token expired"])).toBe("connect");
    expect(reconnectKind(["Instagram account isn't linked in Zernio", "Instagram webhook isn't subscribed"])).toBe("connect");
    expect(reconnectKind(["Zernio isn't set up"])).toBe("connect");
  });

  it("a webhook-only problem repairs the webhook; no problem, no button", () => {
    expect(reconnectKind(["Instagram webhook isn't subscribed"])).toBe("webhook");
    expect(reconnectKind([])).toBeNull();
  });
});
