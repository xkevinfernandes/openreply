import { describe, expect, it } from "vitest";
import {
  assignSchedule,
  followupDelayMs,
  hourLabels,
  humanise,
  nextRunDate,
  normal,
  onTheMinute,
  planTimes,
  seededRng,
  tickPercents,
  windowBounds,
  zonedInstant,
} from "@/lib/os/broadcasts/schedule";

const LUX = "Europe/Luxembourg";
const MIN = 60_000;

describe("zoned times", () => {
  it("reads the window in the workspace timezone (summer and winter)", () => {
    expect(zonedInstant("2026-10-23", "10:00", LUX).toISOString()).toBe("2026-10-23T08:00:00.000Z");
    expect(zonedInstant("2026-12-04", "10:00", LUX).toISOString()).toBe("2026-12-04T09:00:00.000Z");
    const w = windowBounds("2026-10-23", "10:00", "15:00", LUX);
    expect(w.end.getTime() - w.start.getTime()).toBe(5 * 60 * MIN);
  });

  it("next run: the coming Friday, today until the window ends", () => {
    // Mon 19 Oct 2026
    expect(nextRunDate(5, "15:00", LUX, new Date("2026-10-19T09:00:00Z"))).toEqual({ date: "2026-10-23", today: false });
    // Fri 23 Oct 12:00 local: still today
    expect(nextRunDate(5, "15:00", LUX, new Date("2026-10-23T10:00:00Z"))).toEqual({ date: "2026-10-23", today: true });
    // Fri 23 Oct 15:30 local: next week
    expect(nextRunDate(5, "15:00", LUX, new Date("2026-10-23T13:30:00Z"))).toEqual({ date: "2026-10-30", today: false });
  });
});

describe("human pacing", () => {
  const { start, end } = windowBounds("2026-10-23", "10:00", "15:00", LUX);

  it("normal jitter is centred and spread", () => {
    const r = seededRng(7);
    const xs = Array.from({ length: 4000 }, () => normal(r));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(Math.abs(mean)).toBeLessThan(0.08);
    expect(sd).toBeGreaterThan(0.9);
    expect(sd).toBeLessThan(1.1);
  });

  it("never on the minute: no :00 minute, no :00 second", () => {
    const r = seededRng("x");
    for (const t of [zonedInstant("2026-10-23", "11:00", LUX).getTime(), zonedInstant("2026-10-23", "12:30", LUX).getTime()]) {
      const h = humanise(t, LUX, r);
      expect(onTheMinute(h, LUX)).toBe(false);
      expect(h).toBeGreaterThanOrEqual(t);
      expect(h - t).toBeLessThan(7 * MIN);
    }
  });

  it("plans n times inside the window, sorted, apart, off the minute, not a grid", () => {
    for (const seed of [1, 2, 3, 99]) {
      const times = planTimes(9, start, end, LUX, seededRng(seed));
      expect(times).toHaveLength(9);
      for (const [i, t] of times.entries()) {
        expect(t).toBeGreaterThan(start.getTime());
        expect(t).toBeLessThan(end.getTime());
        expect(onTheMinute(t, LUX)).toBe(false);
        if (i) expect(t - times[i - 1]).toBeGreaterThanOrEqual(4 * MIN);
      }
      const gaps = times.slice(1).map((t, i) => t - times[i]);
      expect(new Set(gaps.map((g) => Math.round(g / 1000))).size).toBeGreaterThan(1);
    }
  });

  it("is reproducible from the seed and differs between seeds", () => {
    expect(planTimes(5, start, end, LUX, seededRng("a"))).toEqual(planTimes(5, start, end, LUX, seededRng("a")));
    expect(planTimes(5, start, end, LUX, seededRng("a"))).not.toEqual(planTimes(5, start, end, LUX, seededRng("b")));
  });

  it("a tight window still keeps everyone inside", () => {
    const tight = windowBounds("2026-10-23", "10:00", "10:30", LUX);
    const times = planTimes(12, tight.start, tight.end, LUX, seededRng(5));
    expect(times.every((t) => t > tight.start.getTime() && t < tight.end.getTime() && !onTheMinute(t, LUX))).toBe(true);
  });

  it("follow-up: 3-8 min around 5, about an hour for 60", () => {
    const r = seededRng(3);
    for (let i = 0; i < 200; i++) {
      const d = followupDelayMs(5, r);
      expect(d).toBeGreaterThanOrEqual(3 * MIN);
      expect(d).toBeLessThanOrEqual(9 * MIN);
      const h = followupDelayMs(60, r);
      expect(h).toBeGreaterThanOrEqual(55 * MIN);
      expect(h).toBeLessThanOrEqual(71 * MIN);
    }
  });
});

describe("assignSchedule", () => {
  const { start, end } = windowBounds("2026-10-23", "10:00", "15:00", LUX);
  const at = (hhmm: string) => zonedInstant("2026-10-23", hhmm, LUX).getTime();

  it("earliest deadline goes first; a window closing too soon is outside", () => {
    const out = assignSchedule(
      [
        { id: "late", bubbles: 2, deadline: null },
        { id: "soon", bubbles: 2, deadline: at("10:45") },
        { id: "gone", bubbles: 2, deadline: at("09:30") },
      ],
      { start, end, tz: LUX, rng: seededRng(1), capLeft: 80 }
    );
    const by = Object.fromEntries(out.map((o) => [o.id, o]));
    expect(by.gone.status).toBe("outside_window");
    expect(by.soon.status).toBe("scheduled");
    expect(by.late.status).toBe("scheduled");
    if (by.soon.status === "scheduled" && by.late.status === "scheduled") {
      expect(by.soon.at).toBeLessThan(at("10:45"));
      expect(by.soon.at).toBeLessThan(by.late.at);
    }
  });

  it("the daily cap holds back what would pass it, counting every bubble", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, bubbles: 3, deadline: null }));
    const out = assignSchedule(items, { start, end, tz: LUX, rng: seededRng(2), capLeft: 10 });
    expect(out.filter((o) => o.status === "scheduled")).toHaveLength(3);
    expect(out.filter((o) => o.status === "capped")).toHaveLength(3);
  });

  it("starts from now when the window is already running, and refuses after it", () => {
    const now = new Date(at("13:00"));
    const out = assignSchedule([{ id: "a", bubbles: 1, deadline: null }], { start, end, tz: LUX, rng: seededRng(4), capLeft: 80, now });
    expect(out[0].status === "scheduled" && out[0].at > now.getTime()).toBe(true);
    const after = assignSchedule([{ id: "a", bubbles: 1, deadline: null }], { start, end, tz: LUX, rng: seededRng(4), capLeft: 80, now: new Date(at("15:30")) });
    expect(after[0].status).toBe("outside_window");
  });
});

describe("pacing strip", () => {
  it("ticks as percents and hour labels", () => {
    const { start, end } = windowBounds("2026-10-23", "10:00", "15:00", LUX);
    expect(tickPercents([start.getTime() + (end.getTime() - start.getTime()) / 2], start, end)).toEqual([50]);
    expect(hourLabels("10:00", "15:00")).toEqual(["10:00", "11:00", "12:00", "13:00", "14:00", "15:00"]);
    expect(hourLabels("10:30", "12:00")).toEqual(["10:30", "11:00", "12:00"]);
  });
});
