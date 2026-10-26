// Home's funnel card, inbox counts and the All · funnel board (dm-crm 031/032).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { funnelView, FUNNEL_WINDOWS, type FunnelContact } from "@/lib/os/crm-funnel";
import { funnelColumns } from "@/lib/os/funnel";
import { allBoardData, canDropOn, flowDots, funnelViews, inboxCounts, isUnread, isWindowClosing, shortAge, type InboxCountContact } from "@/lib/os/home-funnel";

const now = new Date("2026-10-26T12:00:00Z");
const HOUR = 3_600_000;
const ago = (h: number) => new Date(now.getTime() - h * HOUR);
const daysAgo = (d: number) => ago(d * 24);

function thread(id: string, over: Partial<InboxCountContact> = {}): InboxCountContact {
  return { id, kind: "SALES", lastInboundAt: ago(1), lastOutboundAt: ago(2), lastOpenedAt: ago(0.5), spam: false, spamOverride: null, archivedAt: null, ...over };
}

function person(id: string, over: Partial<FunnelContact> = {}): FunnelContact {
  return {
    id,
    createdAt: daysAgo(3),
    kind: "SALES",
    kindSource: "entry",
    entryPath: "comment",
    spam: false,
    spamOverride: null,
    archivedAt: null,
    stage: "IN_CONVERSATION",
    setterStage: "open",
    attendance: null,
    columns: funnelColumns(null),
    events: new Set(),
    loggedColumns: new Set(),
    wonAmount: null,
    wonAt: null,
    ...over,
  };
}

describe("inbox counts", () => {
  it("unread: inbound later than last opened, or never opened", () => {
    expect(isUnread(thread("a"))).toBe(false);
    expect(isUnread(thread("a", { lastOpenedAt: ago(3) }))).toBe(true);
    expect(isUnread(thread("a", { lastOpenedAt: null }))).toBe(true);
    expect(isUnread(thread("a", { lastInboundAt: null, lastOpenedAt: null }))).toBe(false);
  });

  it("window closing: they wrote last and the 24h window ends within 4 hours", () => {
    expect(isWindowClosing(thread("a", { lastInboundAt: ago(21), lastOutboundAt: ago(22) }), now)).toBe(true);
    expect(isWindowClosing(thread("a", { lastInboundAt: ago(19.9), lastOutboundAt: null }), now)).toBe(false); // 4.1h left
    expect(isWindowClosing(thread("a", { lastInboundAt: ago(20), lastOutboundAt: null }), now)).toBe(true); // exactly 4h left
    expect(isWindowClosing(thread("a", { lastInboundAt: ago(24.1), lastOutboundAt: null }), now)).toBe(false); // gone
    expect(isWindowClosing(thread("a", { lastInboundAt: ago(21), lastOutboundAt: ago(20) }), now)).toBe(false); // we replied
  });

  it("spam and archived never count; drafts of hidden contacts don't either", () => {
    const rows = [
      thread("unread", { lastOpenedAt: null }),
      thread("closing", { lastInboundAt: ago(22), lastOutboundAt: ago(30), lastOpenedAt: ago(21) }),
      thread("spam", { lastOpenedAt: null, spam: true }),
      thread("spam-cleared", { lastOpenedAt: null, spam: true, spamOverride: false }),
      thread("archived", { lastOpenedAt: null, lastInboundAt: ago(22), lastOutboundAt: null, archivedAt: ago(1) }),
    ];
    expect(inboxCounts(rows, ["unread", "spam", "archived", "not-read", "unread"], now)).toEqual({ unread: 2, draftsWaiting: 2, windowClosing: 1 });
  });
});

describe("funnel shapes", () => {
  const people = [
    person("dm"),
    person("replied", { events: new Set(["conversation_started"]) }),
    person("won", { stage: "WON", events: new Set(["won"]), wonAmount: 1200, wonAt: daysAgo(1) }),
    person("older", { createdAt: daysAgo(20), events: new Set(["conversation_started"]) }),
    person("oldest", { createdAt: daysAgo(60) }),
    person("lost", { stage: "LOST", events: new Set(["conversation_started"]), archivedAt: daysAgo(1) }),
  ];

  it("one read gives each window, same as funnelView", () => {
    const v = funnelViews(people, now);
    for (const w of FUNNEL_WINDOWS) expect(v[w]).toEqual(funnelView(people, w, now));
    expect(v[7].cohort).toBe(4);
    expect(v[30].cohort).toBe(5);
    expect(v[90].cohort).toBe(6);
  });

  it("board reached equals the funnel in every window; archived cards are kept with their flag", () => {
    const info = new Map(people.map((p) => [p.id, { name: p.id, setter: "J", lastAt: null }]));
    const b = allBoardData(people, info, now);
    for (const w of FUNNEL_WINDOWS) {
      const f = funnelView(people, w, now);
      expect(b.windows[w].slice(0, 7).map((c) => c.reached)).toEqual(f.steps.map((s) => s.count));
      expect(b.windows[w].flatMap((c) => c.contactIds).sort()).toEqual(people.filter((p) => p.createdAt >= daysAgo(w)).map((p) => p.id).sort());
    }
    expect(b.cards.lost.archived).toBe(true);
    expect(b.windows[30].find((c) => c.key === "lost")!.contactIds).toEqual(["lost"]);
    expect(b.cards.won.wonAmount).toBe(1200);
    expect(b.cards.replied.wonAmount).toBeNull();
  });

  it("drops only onto Won or Lost", () => {
    expect(canDropOn("won", "replied")).toBe(true);
    expect(canDropOn("lost", "won")).toBe(true);
    expect(canDropOn("won", "won")).toBe(false);
    expect(canDropOn("booked", "replied")).toBe(false);
    expect(canDropOn("qualified", "lost")).toBe(false);
  });

  it("dots drop out where the funnel drops; none for an empty funnel", () => {
    const counts = [214, 131, 74, 41, 18, 14, 6];
    const dots = flowDots(counts, (n) => Math.max(14, Math.round((n / 214) * 100)));
    expect(dots.length).toBeGreaterThan(20);
    expect(dots.length).toBeLessThan(40);
    const ends = [...new Set(dots.map((d) => Math.round(d.end)))];
    expect(ends[0]).toBe(14); // first drop-outs leave after DMs in
    expect(dots.every((d) => d.top > 0 && d.top < 100)).toBe(true);
    expect(flowDots([0, 0, 0, 0, 0, 0, 0], () => 14)).toEqual([]);
  });

  it("short ages", () => {
    expect(shortAge(ago(0.25), now)).toBe("15m");
    expect(shortAge(ago(5), now)).toBe("5h");
    expect(shortAge(daysAgo(3), now)).toBe("3d");
    expect(shortAge(daysAgo(30), now)).toBe("4w");
  });
});

describe("mock sample", () => {
  beforeEach(() => vi.stubEnv("OS_MOCK", "1"));
  afterEach(() => vi.unstubAllEnvs());

  it("looks like a real month: about 200 in, falling at each step, both revenue figures", async () => {
    const { mockHomeContacts } = await import("@/lib/os/mock-home");
    const v = funnelView(mockHomeContacts(now), 30, now);
    const counts = v.steps.map((s) => s.count);
    expect(counts[0]).toBeGreaterThan(150);
    expect(counts[0]).toBeLessThan(260);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
    expect(counts[6]).toBeGreaterThan(0);
    expect(v.revenue.closedInPeriod).toBeGreaterThan(v.revenue.fromCohort);
  });
});

describe("client-safe copies stay in step with the shared funnel", () => {
  it("window key, windows, labels and money", async () => {
    const f = await import("@/lib/os/crm-funnel");
    const v = await import("@/lib/os/home-funnel-view");
    const { formatMoney } = await import("@/lib/os/workspace-settings");
    expect(v.WINDOW_KEY).toBe(f.FUNNEL_WINDOW_KEY);
    expect([...v.WINDOWS]).toEqual([...f.FUNNEL_WINDOWS]);
    expect(v.DEFAULT_WINDOW).toBe(f.DEFAULT_FUNNEL_WINDOW);
    for (const w of f.FUNNEL_WINDOWS) {
      expect(v.windowLabel(w)).toBe(f.cohortLabel(w));
      expect(v.windowFrom(w, now)).toEqual(f.windowStart(w, now));
    }
    for (const x of ["7", 7, "x", null, 45]) expect(v.parseWindow(x)).toBe(f.parseFunnelWindow(x));
    for (const [a, c] of [[14400, "EUR"], [1234.5, "USD"], [0, "GBP"], [5, "XXX1"]] as const) expect(v.money(a, c)).toBe(formatMoney(a, c));
  });
});
