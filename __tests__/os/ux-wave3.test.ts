import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import { avatarExpiry, avatarInitial, liveAvatarUrl } from "@/lib/os/contacts-avatar";
import { clampPanelWidth, PANEL_DEFAULT, PANEL_MAX, PANEL_MIN, panelWidthCookie, parsePanelWidth } from "@/lib/os/contact-panel/width";
import { contactUpToDate } from "@/lib/os/inbox";

describe("liveAvatarUrl", () => {
  const now = Date.UTC(2026, 9, 19);
  const hex = (ms: number) => Math.floor(ms / 1000).toString(16).toUpperCase();

  it("keeps a url that is still valid", () => {
    const url = `https://scontent.cdninstagram.com/p.jpg?_nc_ht=x&oe=${hex(now + 86_400_000)}`;
    expect(liveAvatarUrl(url, now)).toBe(url);
  });

  it("drops an expired IG url so the initials show", () => {
    expect(liveAvatarUrl(`https://scontent.cdninstagram.com/p.jpg?oe=${hex(now - 1000)}&x=1`, now)).toBeNull();
  });

  it("keeps urls without an expiry and drops junk", () => {
    expect(liveAvatarUrl("https://example.com/a.png", now)).toBe("https://example.com/a.png");
    expect(liveAvatarUrl(null, now)).toBeNull();
    expect(liveAvatarUrl("", now)).toBeNull();
    expect(liveAvatarUrl("javascript:alert(1)", now)).toBeNull();
  });

  it("reads the hex expiry", () => {
    expect(avatarExpiry("https://x/p.jpg?oe=6A000000")).toBe(0x6a000000 * 1000);
    expect(avatarExpiry("https://x/p.jpg")).toBeNull();
  });

  it("makes an initial", () => {
    expect(avatarInitial("@maya.builds")).toBe("M");
    expect(avatarInitial("  ")).toBe("?");
    expect(avatarInitial(null)).toBe("?");
  });
});

describe("panel width", () => {
  it("clamps and parses", () => {
    expect(clampPanelWidth(10)).toBe(PANEL_MIN);
    expect(clampPanelWidth(5000)).toBe(PANEL_MAX);
    expect(clampPanelWidth(NaN)).toBe(PANEL_DEFAULT);
    expect(parsePanelWidth("455")).toBe(455);
    expect(parsePanelWidth("abc")).toBe(PANEL_DEFAULT);
    expect(parsePanelWidth(undefined)).toBe(PANEL_DEFAULT);
  });

  it("writes a year-long cookie", () => {
    expect(panelWidthCookie(9999)).toBe(`os_panel_w=${PANEL_MAX}; Path=/; Max-Age=31536000; SameSite=Lax`);
  });
});

describe("contactUpToDate", () => {
  const at = "2026-10-19T09:00:00.000Z";
  const c = { username: "maya", fullName: "Maya", avatarUrl: "a", zernioConversationId: "conv1", lastMessageAt: new Date(at) };
  const t = { username: "maya", fullName: "Maya", avatarUrl: "a", conversationId: "conv1", updatedTime: at };

  it("skips the write when nothing changed", () => {
    expect(contactUpToDate(c, t)).toBe(true);
  });

  it("writes when the picture, handle, thread or time changed", () => {
    expect(contactUpToDate(c, { ...t, avatarUrl: "b" })).toBe(false);
    expect(contactUpToDate(c, { ...t, username: "maya2" })).toBe(false);
    expect(contactUpToDate(c, { ...t, conversationId: "conv2" })).toBe(false);
    expect(contactUpToDate(c, { ...t, updatedTime: "2026-10-19T10:00:00.000Z" })).toBe(false);
    expect(contactUpToDate(c, { ...t, updatedTime: null })).toBe(false);
  });

  it("ignores fields the list didn't send", () => {
    expect(contactUpToDate(c, { ...t, avatarUrl: null, fullName: null })).toBe(true);
  });
});
