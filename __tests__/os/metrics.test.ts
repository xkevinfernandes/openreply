import { describe, expect, it } from "vitest";
import { buildPipeline, greeting, homeDate, nextRunDate, type SetterLite } from "@/lib/os/home";
import {
  conversationStartFromRecord,
  conversationStarts,
  isBareKeyword,
  keywordTriggerEvents,
  outcomeRow,
  parseHomePeriod,
  parsePeriod,
  periodStart,
  sampleOutcomeCounts,
} from "@/lib/os/metrics";

const TZ = "Europe/Luxembourg";
const D = (s: string) => new Date(s);

describe("outcome row", () => {
  it("gives the board's 118→42→26→9→4→3→1 with step-over-step %", () => {
    const row = outcomeRow({ keyword_trigger: 118, conversation_started: 42, lead_magnet_sent: 26, offer_made: 9, call_booked: 4, showed: 3, won: 1 });
    expect(row.map((c) => c.n)).toEqual([118, 42, 26, 9, 4, 3, 1]);
    expect(row.map((c) => c.pct)).toEqual([null, 36, 62, 35, 44, 75, 33]);
    expect(row[0].label).toBe("Keyword triggers");
  });

  it("missing kinds are 0 and a 0 step before gives no %", () => {
    const row = outcomeRow({ keyword_trigger: 5 });
    expect(row[1]).toMatchObject({ n: 0, pct: 0 });
    expect(row[2]).toMatchObject({ n: 0, pct: null });
  });
});

describe("periods", () => {
  it("parses with 7d as default", () => {
    expect(parsePeriod("today")).toBe("today");
    expect(parsePeriod("30d")).toBe("30d");
    expect(parsePeriod("nope")).toBe("7d");
    expect(parsePeriod(undefined)).toBe("7d");
  });

  it("Today starts at local midnight; 7d/30d roll", () => {
    const now = D("2026-10-19T08:30:00Z"); // 10:30 in Luxembourg (CEST)
    expect(periodStart("today", now, TZ).toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(periodStart("7d", now, TZ).toISOString()).toBe("2026-10-12T08:30:00.000Z");
    expect(periodStart("30d", now, TZ).getTime()).toBe(now.getTime() - 30 * 86400_000);
  });
});

describe("conversations started (episode rule)", () => {
  it("never counts a bare keyword hit", () => {
    expect(conversationStarts([{ at: "2026-10-01T10:00:00Z", fromUs: false, text: "SETTER" }], ["setter"])).toEqual([]);
  });

  it("counts the lead's reply after the opener once per episode", () => {
    const starts = conversationStarts(
      [
        { at: "2026-10-01T10:00:00Z", fromUs: false, text: "SETTER" },
        { at: "2026-10-01T10:00:05Z", fromUs: true, text: "here you go" },
        { at: "2026-10-01T11:00:00Z", fromUs: false, text: "thanks! how does it work" },
        { at: "2026-10-01T11:05:00Z", fromUs: true, text: "what are you building?" },
        { at: "2026-10-01T12:00:00Z", fromUs: false, text: "a coaching biz" },
      ],
      ["setter"]
    );
    expect(starts).toHaveLength(1);
    expect(starts[0].at.toISOString()).toBe("2026-10-01T11:00:00.000Z");
  });

  it("a repeated keyword after the opener is still not a conversation", () => {
    const starts = conversationStarts(
      [
        { at: "2026-10-01T10:00:05Z", fromUs: true, text: "here you go" },
        { at: "2026-10-01T10:01:00Z", fromUs: false, text: "setter!" },
      ],
      ["SETTER"]
    );
    expect(starts).toEqual([]);
  });

  it("a long silence starts a new episode", () => {
    const starts = conversationStarts([
      { at: "2026-09-01T10:00:00Z", fromUs: true },
      { at: "2026-09-01T11:00:00Z", fromUs: false, text: "hey" },
      { at: "2026-10-01T10:00:00Z", fromUs: true },
      { at: "2026-10-01T11:00:00Z", fromUs: false, text: "back again" },
    ]);
    expect(starts).toHaveLength(2);
  });

  it("they wrote first, then we answered and they replied: counts", () => {
    const starts = conversationStarts([
      { at: "2026-10-01T10:00:00Z", fromUs: false, text: "hi kevin, love the reels" },
      { at: "2026-10-01T10:05:00Z", fromUs: true, text: "appreciate it" },
      { at: "2026-10-01T10:10:00Z", fromUs: false, text: "quick question" },
    ]);
    expect(starts).toHaveLength(1);
  });

  it("isBareKeyword ignores case and punctuation", () => {
    expect(isBareKeyword("  Setter! ", ["SETTER"])).toBe(true);
    expect(isBareKeyword("setter please", ["SETTER"])).toBe(false);
    expect(isBareKeyword("", ["SETTER"])).toBe(false);
  });
});

describe("conversationStartFromRecord", () => {
  const ids = { workspaceId: "w", contactId: "c1", setterId: "s1" };
  const rec = (over: Record<string, unknown> = {}) => ({
    opener_sent_at: null,
    delivered_at: null,
    our_last_at: null,
    their_last_at: null,
    last_incoming_text_at: null,
    sends: [],
    ...over,
  });

  it("null when only they wrote", () => {
    expect(conversationStartFromRecord(rec({ their_last_at: "2026-10-01T10:00:00Z" }), ids)).toBeNull();
  });

  it("their reply after the opener → one event keyed by the episode start", () => {
    const e = conversationStartFromRecord(rec({ opener_sent_at: "2026-10-01T10:00:00Z", their_last_at: "2026-10-01T11:00:00Z" }), ids)!;
    expect(e.kind).toBe("conversation_started");
    expect(e.dedupeKey).toBe("conversation_started:c1:2026-10-01");
    // A later reply in the same episode has the same key (deduped).
    const later = conversationStartFromRecord(
      rec({ opener_sent_at: "2026-10-01T10:00:00Z", sends: [{ at: "2026-10-02T09:00:00Z" }], their_last_at: "2026-10-03T11:00:00Z" }),
      ids
    )!;
    expect(later.dedupeKey).toBe(e.dedupeKey);
  });

  it("a new episode after a long silence gets a new key", () => {
    const e = conversationStartFromRecord(
      rec({ opener_sent_at: "2026-08-01T10:00:00Z", sends: [{ at: "2026-10-01T09:00:00Z" }], their_last_at: "2026-10-01T11:00:00Z" }),
      ids
    )!;
    expect(e.dedupeKey).toBe("conversation_started:c1:2026-10-01");
  });

  it("their message weeks after our last one isn't a reply to it", () => {
    expect(conversationStartFromRecord(rec({ opener_sent_at: "2026-08-01T10:00:00Z", their_last_at: "2026-10-01T11:00:00Z" }), ids)).toBeNull();
  });
});

describe("keyword triggers", () => {
  it("one event per DmLog, keyed by its id", () => {
    const e = keywordTriggerEvents([{ id: "d1", workspaceId: "w", automationId: "a1", matchedKeyword: "SETTER", createdAt: D("2026-10-10T10:00:00Z") }]);
    expect(e[0]).toMatchObject({ kind: "keyword_trigger", dedupeKey: "keyword_trigger:d1", data: { automationId: "a1", keyword: "SETTER" } });
  });
});

describe("Home helpers", () => {
  it("greets by the workspace's local hour", () => {
    expect(greeting(D("2026-10-19T07:00:00Z"), TZ)).toBe("Good morning");
    expect(greeting(D("2026-10-19T13:00:00Z"), TZ)).toBe("Good afternoon");
    expect(greeting(D("2026-10-19T19:00:00Z"), TZ)).toBe("Good evening");
    expect(homeDate(D("2026-10-19T07:00:00Z"), TZ)).toBe("Monday 19 October");
  });

  it("next Friday run; Friday counts until the window ends", () => {
    expect(nextRunDate(5, "15:00", TZ, D("2026-10-19T08:00:00Z"))).toEqual({ date: "2026-10-23", today: false });
    expect(nextRunDate(5, "15:00", TZ, D("2026-10-23T08:00:00Z"))).toEqual({ date: "2026-10-23", today: true });
    expect(nextRunDate(5, "15:00", TZ, D("2026-10-23T14:00:00Z"))).toEqual({ date: "2026-10-30", today: false });
  });

  it("pipeline per setter: unassigned contacts belong to the default setter", () => {
    const setters: SetterLite[] = [
      { id: "nova", name: "Nova", isDefault: false, autonomy: "APPROVE", funnel: [] },
      { id: "j", name: "J", isDefault: true, autonomy: "APPROVE", funnel: [] },
    ];
    const contacts = [
      { setterId: null, stage: "IN_CONVERSATION" as const, setterStage: "qualify", attendance: null },
      { setterId: "j", stage: "CALL_BOOKED" as const, setterStage: "booked", attendance: null },
      { setterId: "nova", stage: "NEW" as const, setterStage: "value", attendance: null },
    ];
    const { pipeline, cards } = buildPipeline(setters, contacts, [{ contactId: "x", setterId: null }], null);
    expect(pipeline.setters.map((s) => s.name)).toEqual(["J", "Nova"]);
    expect(pipeline.selected).toBe("j");
    const by = Object.fromEntries(pipeline.rows.map((r) => [r.key, r.count]));
    expect(by.qualify).toBe(1);
    expect(by.booked).toBe(1);
    expect(by.value).toBe(0);
    expect(cards).toEqual([
      { id: "j", name: "J", open: 1, drafts: 1, mode: "Approve-only" },
      { id: "nova", name: "Nova", open: 1, drafts: 0, mode: "Approve-only" },
    ]);
    const nova = buildPipeline(setters, contacts, [], "nova").pipeline;
    expect(Object.fromEntries(nova.rows.map((r) => [r.key, r.count])).value).toBe(1);
  });
});

describe("Home's one period switch", () => {
  it("7d / 30d / 90d, 30d by default, old ?period=today lands on 7d", () => {
    expect(parseHomePeriod(undefined)).toBe("30d");
    expect(parseHomePeriod("7d")).toBe("7d");
    expect(parseHomePeriod("90d")).toBe("90d");
    expect(parseHomePeriod("today")).toBe("7d");
    expect(parseHomePeriod("x")).toBe("30d");
    const now = D("2026-10-26T12:00:00Z");
    expect(periodStart("90d", now, TZ).toISOString()).toBe("2026-07-28T12:00:00.000Z");
  });

  it("the sample tiles count the same people as the funnel, never a step above the one before", () => {
    const now = D("2026-10-26T12:00:00Z");
    const c = (days: number, over: Partial<Parameters<typeof sampleOutcomeCounts>[0][number]> = {}) => ({
      createdAt: new Date(now.getTime() - days * 86_400_000),
      kind: "SALES",
      spam: false,
      spamOverride: null,
      entryPath: "keyword_dm",
      stage: "IN_CONVERSATION",
      attendance: null,
      events: new Set<string>(["conversation_started"]),
      ...over,
    });
    const counts = sampleOutcomeCounts(
      [
        c(1),
        c(2, { entryPath: "story_reply", events: new Set(["conversation_started", "offer_made", "call_booked"]), attendance: "SHOWED" }),
        c(3, { events: new Set(), stage: "LEAD_MAGNET_SENT" }),
        c(4, { kind: "PERSONAL" }),
        c(5, { spam: true }),
        c(40),
      ],
      D("2026-10-19T12:00:00Z"),
      now
    );
    expect(counts).toEqual({ keyword_trigger: 3, conversation_started: 2, lead_magnet_sent: 2, offer_made: 1, call_booked: 1, showed: 1 });
  });
});
