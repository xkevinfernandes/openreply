import { describe, expect, it } from "vitest";
import {
  accountProblems,
  actionNeeded,
  filterCounts,
  filterRows,
  keywordClashes,
  parseFilter,
  triggerLabel,
  triggersOverlap,
  type AccountHealth,
  type ActionInput,
  type AutomationRow,
  type TriggerShape,
} from "../../lib/os/automations";
import { setterForCampaign } from "../../lib/os/automations-data";
import { diagnosticsVerdict, dmStatusLabel, logsQuery, parseSettingsTab, ago } from "../../lib/os/settings";
import { osHrefForUpstream } from "../../lib/os/upstream-routes";

const NOW = new Date("2026-10-18T12:00:00Z");
const ok = { zernioReady: true, kitConnected: true };
const zernioAccount: AccountHealth = { provider: "ZERNIO", tokenExpiresAt: null, webhookSubscribed: true, zernioAccountId: "z1" };

function shape(over: Partial<TriggerShape> = {}): TriggerShape {
  return {
    id: "a",
    name: "A",
    instagramAccountId: "acc1",
    isActive: true,
    keywords: ["setter"],
    matchAnyWord: false,
    postId: "p1",
    matchAnyPost: false,
    pendingNextReel: false,
    dmTriggerEnabled: false,
    ...over,
  };
}

function input(over: Partial<ActionInput> = {}): ActionInput {
  return { ...shape(), requireEmail: false, recentFailures: 0, account: zernioAccount, ...over };
}

function row(over: Partial<AutomationRow> = {}): AutomationRow {
  return {
    id: "r",
    name: "Setter reel",
    instagramAccountId: "acc1",
    username: "claudepreneur",
    postId: "p1",
    postUrl: null,
    matchAnyPost: false,
    pendingNextReel: false,
    dmTriggerEnabled: false,
    keywords: ["setter"],
    matchAnyWord: false,
    opener: "here's the prompt",
    requireEmail: false,
    requireFollow: false,
    isActive: true,
    setter: { id: "s1", name: "Claudepreneur", viaCampaign: false },
    runs: 0,
    sent: 0,
    failed: 0,
    clicks: 0,
    ctr: 0,
    actions: [],
    createdAt: NOW.toISOString(),
    ...over,
  };
}

describe("action needed", () => {
  it("a healthy running campaign needs nothing", () => {
    expect(actionNeeded(input(), [shape()], ok, NOW)).toEqual([]);
  });

  it("a paused campaign never needs action, even when broken", () => {
    expect(actionNeeded(input({ isActive: false, recentFailures: 9, account: null }), [], ok, NOW)).toEqual([]);
  });

  it("flags recent failed DMs", () => {
    expect(actionNeeded(input({ recentFailures: 1 }), [], ok, NOW)).toEqual(["1 DM failed in the last 7 days"]);
    expect(actionNeeded(input({ recentFailures: 3 }), [], ok, NOW)[0]).toMatch(/^3 DMs failed/);
  });

  it("flags a disconnected or half-connected account", () => {
    expect(actionNeeded(input({ account: null }), [], ok, NOW)).toContain("Instagram account is disconnected");
    expect(accountProblems(zernioAccount, { ...ok, zernioReady: false }, NOW)).toEqual(["Zernio isn't set up"]);
    expect(accountProblems({ ...zernioAccount, zernioAccountId: null }, ok, NOW)).toEqual(["Instagram account isn't linked in Zernio"]);
    expect(
      accountProblems({ provider: "META", tokenExpiresAt: new Date("2026-10-01"), webhookSubscribed: false, zernioAccountId: null }, ok, NOW)
    ).toEqual(["Instagram token expired", "Instagram webhook isn't subscribed"]);
    expect(accountProblems({ provider: "META", tokenExpiresAt: new Date("2026-12-01"), webhookSubscribed: true, zernioAccountId: null }, ok, NOW)).toEqual([]);
  });

  it("flags an email gate without Kit", () => {
    expect(actionNeeded(input({ requireEmail: true }), [], { ...ok, kitConnected: false }, NOW)).toEqual(["Email gate is on but Kit isn't connected"]);
    expect(actionNeeded(input({ requireEmail: true }), [], ok, NOW)).toEqual([]);
  });

  it("flags a campaign with nothing to trigger it", () => {
    expect(actionNeeded(input({ postId: null }), [], ok, NOW)).toEqual(["No post or DM trigger"]);
    expect(actionNeeded(input({ postId: null, dmTriggerEnabled: true }), [], ok, NOW)).toEqual([]);
    expect(actionNeeded(input({ postId: null, pendingNextReel: true }), [], ok, NOW)).toEqual([]);
  });

  it("flags a keyword another running campaign also answers", () => {
    const a = shape({ id: "a", name: "A", keywords: ["Setter"] });
    const b = shape({ id: "b", name: "B", keywords: ["setter", "x"] });
    expect(actionNeeded(input({ ...a }), [a, b], ok, NOW)).toEqual(["“setter” is also a keyword in B"]);
  });
});

describe("keyword clashes", () => {
  it("needs the same account and an overlapping trigger", () => {
    const a = shape({ id: "a" });
    expect(triggersOverlap(a, shape({ id: "b", instagramAccountId: "acc2" }))).toBe(false);
    expect(triggersOverlap(a, shape({ id: "b", postId: "p2" }))).toBe(false);
    expect(triggersOverlap(a, shape({ id: "b", postId: null, matchAnyPost: true }))).toBe(true);
    expect(triggersOverlap(shape({ dmTriggerEnabled: true, postId: null }), shape({ id: "b", dmTriggerEnabled: true, postId: "p9" }))).toBe(true);
    expect(triggersOverlap(shape({ postId: null, pendingNextReel: true }), shape({ id: "b", postId: "p1" }))).toBe(false);
  });

  it("ignores paused campaigns and treats 'any word' as every keyword", () => {
    const a = shape({ id: "a", keywords: ["setter", "prompt"] });
    expect(keywordClashes(a, [a, shape({ id: "b", isActive: false })])).toEqual([]);
    expect(keywordClashes(a, [a, shape({ id: "b", name: "B", matchAnyWord: true, keywords: [] })]).map((c) => c.keyword)).toEqual([
      "setter",
      "prompt",
    ]);
    expect(keywordClashes(shape({ id: "a", matchAnyWord: true }), [shape({ id: "b" })])).toEqual([]);
  });
});

describe("filters and search", () => {
  const rows = [
    row({ id: "1", name: "Setter reel", isActive: true, actions: ["1 DM failed in the last 7 days"] }),
    row({ id: "2", name: "Workshop", keywords: ["workshop"], opener: "replay is here", isActive: true, setter: null }),
    row({ id: "3", name: "Notion", keywords: ["template"], isActive: false, username: "kevin" }),
  ];

  it("counts and filters by status", () => {
    expect(filterCounts(rows)).toEqual({ all: 3, active: 2, inactive: 1, action: 1 });
    expect(filterRows(rows, "active", "").map((r) => r.id)).toEqual(["1", "2"]);
    expect(filterRows(rows, "inactive", "").map((r) => r.id)).toEqual(["3"]);
    expect(filterRows(rows, "action", "").map((r) => r.id)).toEqual(["1"]);
  });

  it("searches name, keyword, opener, account and setter", () => {
    expect(filterRows(rows, "all", "WORKSHOP").map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, "all", "template").map((r) => r.id)).toEqual(["3"]);
    expect(filterRows(rows, "all", "replay").map((r) => r.id)).toEqual(["2"]);
    expect(filterRows(rows, "all", "kevin").map((r) => r.id)).toEqual(["3"]);
    expect(filterRows(rows, "all", "claudepreneur").map((r) => r.id)).toEqual(["1", "2", "3"]); // account or setter name
    expect(filterRows(rows, "inactive", "setter")).toEqual([]);
    expect(filterRows(rows, "all", "  ").length).toBe(3);
  });

  it("parses the filter from the URL", () => {
    expect(parseFilter("action")).toBe("action");
    expect(parseFilter("nope")).toBe("all");
    expect(parseFilter(undefined)).toBe("all");
  });

  it("labels the trigger", () => {
    expect(triggerLabel(row())).toBe("One post");
    expect(triggerLabel(row({ matchAnyPost: true, dmTriggerEnabled: true }))).toBe("Any post + DMs");
    expect(triggerLabel(row({ postId: null, pendingNextReel: true }))).toBe("Next reel");
    expect(triggerLabel(row({ postId: null }))).toBe("No trigger");
  });
});

describe("which setter answers a campaign", () => {
  const t = (d: number) => new Date(2026, 0, d);
  const setters = [
    { id: "ws", name: "Workspace", isDefault: true, instagramAccountId: null, createdAt: t(1) },
    { id: "own", name: "Account", isDefault: true, instagramAccountId: "acc1", createdAt: t(2) },
    { id: "other", name: "Workshop", isDefault: false, instagramAccountId: null, createdAt: t(3) },
  ];

  it("campaign override, then the account default, then the workspace default", () => {
    expect(setterForCampaign("a", "acc1", new Map([["a", "other"]]), setters)).toEqual({ id: "other", name: "Workshop", viaCampaign: true });
    expect(setterForCampaign("a", "acc1", new Map(), setters)).toEqual({ id: "own", name: "Account", viaCampaign: false });
    expect(setterForCampaign("a", "acc2", new Map(), setters)?.id).toBe("ws");
  });

  it("falls back to the oldest setter, and to none", () => {
    expect(setterForCampaign("a", "acc1", new Map([["a", "gone"]]), [setters[2]])?.id).toBe("other");
    expect(setterForCampaign("a", "acc1", new Map(), [])).toBeNull();
  });
});

describe("settings", () => {
  it("parses the tab", () => {
    expect(parseSettingsTab("logs")).toBe("logs");
    expect(parseSettingsTab("x")).toBe("instagram");
  });

  it("builds the /api/logs query, dropping unknown statuses", () => {
    expect(logsQuery("FAILED", 2)).toBe("page=2&limit=25&status=FAILED");
    expect(logsQuery("all", 0)).toBe("page=1&limit=25");
    expect(logsQuery("DROP TABLE", 1)).toBe("page=1&limit=25");
    expect(dmStatusLabel("SKIPPED_DEDUP")).toBe("Already sent");
  });

  it("gives one verdict for diagnostics", () => {
    const fine = { workerHealthy: true, workerAgeMs: 4000, queue: {}, webhookFailures: 0, dmFailures: 0, tokenRefreshFailures: 0 };
    expect(diagnosticsVerdict(fine)).toEqual({ tone: "good", text: "Everything's running." });
    expect(diagnosticsVerdict({ ...fine, workerHealthy: false, workerAgeMs: null }).tone).toBe("bad");
    expect(diagnosticsVerdict({ ...fine, tokenRefreshFailures: 1 }).tone).toBe("bad");
    expect(diagnosticsVerdict({ ...fine, queue: { failed: 2 }, webhookFailures: 1 })).toEqual({
      tone: "warn",
      text: "Running, but 2 failed jobs in the queue, 1 webhook failed.",
    });
    expect(ago(65_000)).toBe("1 min ago");
    expect(ago(null)).toBe("never");
  });
});

describe("upstream routes map to ours", () => {
  it("rewrites the builder's redirects", () => {
    expect(osHrefForUpstream("/campaigns")).toBe("/os/automations");
    expect(osHrefForUpstream("/campaigns/new")).toBe("/os/automations/new");
    expect(osHrefForUpstream("/campaigns/abc123")).toBe("/os/automations/abc123");
    expect(osHrefForUpstream("/campaigns/abc123/edit?x=1#y")).toBe("/os/automations/abc123?x=1#y");
    expect(osHrefForUpstream("/logs")).toBe("/os/settings?tab=logs");
    expect(osHrefForUpstream("/os/inbox")).toBe("/os/inbox");
    expect(osHrefForUpstream("https://instagram.com/x")).toBe("https://instagram.com/x");
  });
});
