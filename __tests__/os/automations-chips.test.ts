import { describe, expect, it } from "vitest";
import { chipCounts, firstUrl, matchesChip, parseChip, shortLink, triggerKinds, triggerSummary } from "@/lib/os/automations";
import { broadcastStatus } from "@/lib/os/automations-data";

const row = (over: Partial<Parameters<typeof triggerKinds>[0] & { name: string }> = {}) => ({
  name: "AI setter demo",
  postId: null as string | null,
  postUrl: null as string | null,
  matchAnyPost: false,
  pendingNextReel: false,
  dmTriggerEnabled: false,
  ...over,
});

describe("trigger chips", () => {
  it("reel from /reel/ in the post URL, else post; DM keyword from dmTriggerEnabled", () => {
    expect(triggerKinds(row({ postId: "p", postUrl: "https://www.instagram.com/reel/abc/" }))).toEqual(["reels"]);
    expect(triggerKinds(row({ postId: "p", postUrl: "https://www.instagram.com/p/abc/" }))).toEqual(["posts"]);
    expect(triggerKinds(row({ pendingNextReel: true }))).toEqual(["reels"]);
    expect(triggerKinds(row({ matchAnyPost: true, dmTriggerEnabled: true }))).toEqual(["posts", "dm"]);
    expect(triggerKinds(row({ dmTriggerEnabled: true }))).toEqual(["dm"]);
  });

  it("counts per chip; Stories stays 0 (no story trigger upstream)", () => {
    const rows = [row({ postId: "1", postUrl: "/reel/1" }), row({ postId: "2", postUrl: "/p/2" }), row({ dmTriggerEnabled: true })];
    expect(chipCounts(rows)).toEqual({ all: 3, stories: 0, reels: 1, posts: 1, dm: 1 });
    expect(rows.filter((r) => matchesChip(r, "reels"))).toHaveLength(1);
    expect(rows.filter((r) => matchesChip(r, "all"))).toHaveLength(3);
    expect(rows.filter((r) => matchesChip(r, "stories"))).toHaveLength(0);
  });

  it("parses the chip from the URL", () => {
    expect(parseChip("reels")).toBe("reels");
    expect(parseChip("x")).toBe("all");
  });

  it("summarises the trigger like the board", () => {
    expect(triggerSummary(row({ postId: "p", postUrl: "https://instagram.com/reel/x" }))).toEqual({ trigger: "Comment on post", where: "Reel · AI setter demo" });
    expect(triggerSummary(row({ dmTriggerEnabled: true, name: "DM scripts" }))).toEqual({ trigger: "DM keyword", where: "DM scripts" });
    expect(triggerSummary(row({ matchAnyPost: true }))).toEqual({ trigger: "Comment on post", where: "Any post" });
  });

  it("links", () => {
    expect(firstUrl("here you go https://claudepreneur.com/starter. enjoy")).toBe("https://claudepreneur.com/starter");
    expect(firstUrl("no link")).toBeNull();
    expect(shortLink("https://www.claudepreneur.com/vault/")).toBe("claudepreneur.com/vault");
  });
});

describe("broadcast status", () => {
  const b = { enabled: true, windowDay: 5, windowEnd: "15:00", timezone: "Europe/Luxembourg" };
  const now = new Date("2026-10-19T08:00:00Z");
  it("needs a link until this week's run exists", () => {
    expect(broadcastStatus(b, [], now)).toBe("needs_link");
    expect(broadcastStatus(b, [{ runDate: "2026-10-23", status: "review" }], now)).toBe("review");
    expect(broadcastStatus(b, [{ runDate: "2026-10-23", status: "scheduled" }], now)).toBe("scheduled");
    expect(broadcastStatus({ ...b, enabled: false }, [], now)).toBe("off");
    expect(broadcastStatus({ ...b, enabled: false, template: "hey {first_name} {link}" }, [], now)).toBe("needs_link");
  });
});
