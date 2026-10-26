// The shared funnel (dm-crm 031/032): Home's funnel and the All · funnel board
// come from the same functions, so "reached" always equals the funnel.
import { describe, expect, it } from "vitest";
import { boardColumn, cohortLabel, funnelBoard, funnelView, furthestStepIndex, parseFunnelWindow, type FunnelContact } from "@/lib/os/crm-funnel";
import { funnelColumns } from "@/lib/os/funnel";
import { formatMoney, validatePatch } from "@/lib/os/workspace-settings";

const now = new Date("2026-10-26T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const columns = funnelColumns(null);

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
    columns,
    events: new Set(),
    loggedColumns: new Set(),
    wonAmount: null,
    wonAt: null,
    ...over,
  };
}

const people: FunnelContact[] = [
  person("dm"),
  person("replied", { events: new Set(["conversation_started"]) }),
  person("qual-log", { events: new Set(["conversation_started"]), loggedColumns: new Set(["qualify"]) }),
  person("offer-no-history", { events: new Set(["offer_made"]) }),
  person("booked", { stage: "CALL_BOOKED", events: new Set(["conversation_started", "call_booked"]) }),
  person("showed", { stage: "SHOWED", events: new Set(["call_booked", "showed"]) }),
  person("won", { stage: "WON", events: new Set(["won"]), wonAmount: 1200, wonAt: daysAgo(1) }),
  person("won-no-amount", { stage: "WON" }),
  person("won-then-lost", { stage: "LOST", events: new Set(["won", "conversation_started"]) }),
  person("archived", { archivedAt: daysAgo(1), events: new Set(["conversation_started"]) }),
  person("personal", { kind: "PERSONAL", events: new Set(["conversation_started"]) }),
  person("pitch", { kind: "PITCHES" }),
  person("spam", { spam: true }),
  person("not-spam", { spam: true, spamOverride: false }),
  person("imported", { kindSource: "import" }),
  person("old", { createdAt: daysAgo(40), stage: "WON", wonAmount: 500, wonAt: daysAgo(2) }),
];

describe("the funnel", () => {
  const f = funnelView(people, 30, now);

  it("counts Sales/Unsorted only; spam, Personal, Pitches and imports left out; archived counted", () => {
    expect(f.cohort).toBe(11); // 16 minus personal, pitch, spam, imported, old (outside 30 days)
  });

  it("each step counts people who reached it or later: never more than the step before", () => {
    expect(f.steps.map((s) => [s.key, s.count])).toEqual([
      ["dms_in", 11],
      ["replied", 9],
      ["qualified", 6],
      ["call_offered", 5],
      ["booked", 4],
      ["showed", 3],
      ["won", 2],
    ]);
    for (let i = 1; i < f.steps.length; i++) expect(f.steps[i].count).toBeLessThanOrEqual(f.steps[i - 1].count);
    expect(f.steps[1].pctOfPrevious).toBe(82);
  });

  it("revenue: from this cohort, closed in period (whoever), and wins with no amount listed", () => {
    expect(f.revenue.fromCohort).toBe(1200);
    expect(f.revenue.closedInPeriod).toBe(1700);
    expect(f.revenue.noAmount).toEqual(["won-no-amount"]);
  });

  it("Won → Lost drops someone from Won and revenue at once", () => {
    expect(furthestStepIndex(people.find((p) => p.id === "won-then-lost")!)).toBe(1);
  });

  it("the window switch: 7, 30 or 90 days; empty says so", () => {
    expect(funnelView(people, 90, now).cohort).toBe(12);
    expect(funnelView([], 7, now)).toMatchObject({ empty: true, cohort: 0 });
    expect(parseFunnelWindow("90")).toBe(90);
    expect(parseFunnelWindow("12")).toBe(30);
    expect(cohortLabel(30)).toBe("People who first DMed or commented in the last 30 days");
  });
});

describe("the All · funnel board", () => {
  it("places each contact once; its 'reached' equals the funnel in every window", () => {
    for (const w of [7, 30, 90] as const) {
      const b = funnelBoard(people, w, now, { showArchived: true });
      const f = funnelView(people, w, now);
      expect(b.columns.slice(0, 7).map((c) => c.reached)).toEqual(f.steps.map((s) => s.count));
      const placed = b.columns.flatMap((c) => c.contactIds);
      expect(new Set(placed).size).toBe(placed.length);
      expect(placed.length).toBe(f.cohort);
    }
  });

  it("Won and Lost have their own columns; the rest sit at their furthest step", () => {
    const by = (id: string) => boardColumn(people.find((p) => p.id === id)!);
    expect(by("won")).toBe("won");
    expect(by("won-then-lost")).toBe("lost");
    expect(by("offer-no-history")).toBe("call_offered");
    expect(by("qual-log")).toBe("qualified");
  });

  it("archived cards hide without the filter, but always count in reached", () => {
    const hidden = funnelBoard(people, 30, now);
    const shown = funnelBoard(people, 30, now, { showArchived: true });
    expect(hidden.columns.flatMap((c) => c.contactIds)).not.toContain("archived");
    expect(hidden.columns.map((c) => c.reached)).toEqual(shown.columns.map((c) => c.reached));
  });
});

describe("workspace currency", () => {
  it("validates and formats", () => {
    expect(validatePatch({ currency: "usd" })).toEqual({ patch: { currency: "USD" } });
    expect(validatePatch({ currency: "euro" })).toHaveProperty("error");
    expect(formatMoney(1200, "EUR")).toBe("€1,200");
  });
});
