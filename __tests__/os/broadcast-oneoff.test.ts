// One-off broadcast rules, pure: link normalising (the guard), Now's end
// time, Window checks, Duplicate's date, variations and the status table.
import { describe, expect, it } from "vitest";
import {
  alreadyHadLink,
  asWritten,
  capFigures,
  datedName,
  defaultNowEnd,
  duplicateDate,
  fromVariation,
  linksIn,
  normaliseLink,
  nowEndError,
  spreadEvenly,
  statusFromRun,
  windowError,
} from "@/lib/os/broadcasts/oneoff";
import { fallbackVariations, parseVariationsDraft, writeVariations } from "@/lib/os/broadcasts/personalise";
import { seededRng, zonedInstant } from "@/lib/os/broadcasts/schedule";
import type { BroadcastBubble } from "@/lib/os/broadcasts/types";
import { broadcastsUsing } from "@/lib/os/broadcasts/resources";
import { deleteBlockers, usedByOf } from "@/lib/os/resources-view";

const LUX = "Europe/Luxembourg";
const local = (date: string, hhmm: string) => zonedInstant(date, hhmm, LUX);

describe("links", () => {
  it("normalise: lower-case host, no www, no trailing slash, no tracking params", () => {
    const want = "kevinfernandes.me/script-vault";
    for (const u of [
      "https://KevinFernandes.me/script-vault",
      "https://www.kevinfernandes.me/script-vault/",
      "http://kevinfernandes.me/script-vault?utm_source=ig&utm_medium=dm",
      "kevinfernandes.me/script-vault?fbclid=abc#top",
      "https://kevinfernandes.me/script-vault?igshid=x",
    ])
      expect(normaliseLink(u)).toBe(want);
    expect(normaliseLink("https://youtube.com/watch?v=abc&utm_campaign=x")).toBe("youtube.com/watch?v=abc");
    expect(normaliseLink("not a link")).toBeNull();
    expect(linksIn(["here: https://Example.com/a/.", "and www.example.com/b"])).toEqual(["example.com/a", "example.com/b"]);
  });

  it("the guard finds earlier sends and Send-myself links", () => {
    const had = alreadyHadLink(["example.com/a"], [
      { contactId: "c1", bubbles: ["hey", "https://example.com/a/?utm_source=x"], sentLinks: [], at: "2026-10-23T10:00:00Z" },
      { contactId: "c2", bubbles: [], sentLinks: ["https://www.example.com/a"], at: null },
      { contactId: "c3", bubbles: ["https://example.com/b"], sentLinks: [], at: null },
    ]);
    expect([...had.keys()].sort()).toEqual(["c1", "c2"]);
    expect(had.get("c1")).toBe("2026-10-23T10:00:00Z");
  });
});

describe("Start", () => {
  it("Now's default end: 15:00, or two hours from now once passed; never past midnight", () => {
    expect(defaultNowEnd(local("2026-10-30", "09:00"), LUX)).toBe("15:00");
    expect(defaultNowEnd(local("2026-10-30", "16:02"), LUX)).toBe("18:05");
    expect(defaultNowEnd(local("2026-10-30", "22:50"), LUX)).toBe("23:59");
  });

  it("refuses a past or not-after-now end, and a passed window", () => {
    const now = local("2026-10-30", "14:00");
    expect(nowEndError("15:00", now, LUX)).toBeNull();
    expect(nowEndError("14:00", now, LUX)).toBe("Pick an end time later than now.");
    expect(nowEndError("09:00", now, LUX)).toBe("Pick an end time later than now.");
    expect(windowError("2026-10-30", "10:00", "13:00", now, LUX)).toBe("That window has already ended.");
    expect(windowError("2026-10-30", "10:00", "15:00", now, LUX)).toBeNull();
    expect(windowError(null, "10:00", "15:00", now, LUX)).toBe("Pick a date.");
    expect(windowError("2026-11-06", "15:00", "10:00", now, LUX)).toBe("The window has to end after it starts.");
  });

  it("Duplicate's date: the next same weekday counting today, unless today's end passed", () => {
    const b = { sendDate: "2026-10-23", windowEnd: "15:00", timezone: LUX };
    expect(duplicateDate(b, local("2026-10-26", "09:00"))).toBe("2026-10-30");
    expect(duplicateDate(b, local("2026-10-30", "14:59"))).toBe("2026-10-30");
    expect(duplicateDate(b, local("2026-10-30", "15:00"))).toBe("2026-11-06");
    expect(duplicateDate({ ...b, sendDate: null }, local("2026-10-26", "09:00"))).toBeNull();
    expect(datedName("Follow-up Friday · 23 Oct", "2026-10-30", LUX)).toBe("Follow-up Friday · 30 Oct");
    expect(datedName("Webinar replay", null, LUX)).toBe("Webinar replay");
  });
});

describe("the message", () => {
  const bubbles: BroadcastBubble[] = [
    { type: "text", text: "Hey {first_name}," },
    { type: "link", url: "https://a.example/x" },
    { type: "text", text: "no pressure" },
  ];
  it("as written keeps the order, links alone, {first_name} filled", () => {
    expect(asWritten(bubbles, { fullName: "Maya Lee", username: "maya" })).toEqual(["Hey Maya,", "https://a.example/x", "no pressure"]);
  });
  it("a variation takes the text bubbles' places; links untouched", () => {
    expect(fromVariation(bubbles, ["Yo {first_name}!", "zero pressure"], { fullName: null, username: "tom.k" })).toEqual(["Yo tom!", "https://a.example/x", "zero pressure"]);
    expect(fromVariation(bubbles, ["one line only"], { fullName: "Ava", username: null })).toEqual(["one line only", "https://a.example/x"]);
  });
  it("people spread evenly over the variations", () => {
    const ids = Array.from({ length: 23 }, (_, i) => `c${i}`);
    const spread = spreadEvenly(ids, 5, seededRng("x"));
    const counts = [0, 0, 0, 0, 0];
    for (const v of spread.values()) counts[v]++;
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
  it("5 variations: J's, filled up by the fallback; never a link", async () => {
    expect(fallbackVariations(["hey {first_name}, made this"], 5)).toHaveLength(5);
    expect(parseVariationsDraft({ variations: [["a https://x.y/z"], "b\nc", []] }, 5)).toEqual([["a"], ["b", "c"]]);
    let calls = 0;
    const got = await writeVariations(["hey {first_name}"], "F", async () => {
      calls++;
      return { variations: [["v1"], ["v2"]] };
    }, 5);
    expect(calls).toBe(1);
    expect(got).toHaveLength(5);
    expect(got.slice(0, 2)).toEqual([["v1"], ["v2"]]);
    expect(await writeVariations(["hey"], "F", null, 5)).toHaveLength(5);
  });
});

describe("cap figures and status", () => {
  it("planned messages against what's left; a full cap", () => {
    const start = local("2026-10-30", "10:00");
    const end = local("2026-10-30", "15:00");
    const f = capFigures({ perPersonPlanned: [3, 3, 3, 3], cap: { sentToday: 74, cap: 80 }, today: true, mode: "window", start, end, now: local("2026-10-30", "08:00"), tz: LUX });
    expect(f).toMatchObject({ planned: 12, left: 6, people: 4, fit: 2, full: false, over: true });
    const other = capFigures({ perPersonPlanned: [3, 3], cap: { sentToday: 80, cap: 80 }, today: false, mode: "window", start, end, now: local("2026-10-29", "08:00"), tz: LUX });
    expect(other).toMatchObject({ left: 80, full: false, over: false });
    expect(capFigures({ perPersonPlanned: [1], cap: { sentToday: 80, cap: 80 }, today: true, mode: "now", start, end, now: start, tz: LUX }).full).toBe(true);
  });

  it("the status table", () => {
    expect(statusFromRun(null, [])).toBe("draft");
    expect(statusFromRun({ status: "drafting" }, [])).toBe("drafting");
    expect(statusFromRun({ status: "review" }, [])).toBe("in_review");
    expect(statusFromRun({ status: "scheduled" }, [{ status: "scheduled" }])).toBe("scheduled");
    expect(statusFromRun({ status: "scheduled" }, [{ status: "sent" }, { status: "scheduled" }])).toBe("sending");
    expect(statusFromRun({ status: "done" }, [])).toBe("sent");
  });
});

describe("resources in broadcasts (Part C 024)", () => {
  const rows = [
    { key: "fff-30-oct", name: "Follow-up Friday · 30 Oct", status: "in_review", bubbles: [{ type: "link", url: "https://v", resourceId: "r1" }] },
    { key: "fff-23-oct", name: "Follow-up Friday · 23 Oct", status: "sent", bubbles: [{ type: "link", url: "https://v", resourceId: "r1" }] },
    { key: "other", name: "Other", status: "draft", bubbles: [{ type: "link", url: "https://w", resourceId: "r2" }] },
  ];
  it("Used by lists the broadcasts whose link bubbles use it", () => {
    expect(broadcastsUsing("r1", rows).map((b) => [b.key, b.unsent])).toEqual([
      ["fff-30-oct", true],
      ["fff-23-oct", false],
    ]);
  });
  it("delete is refused for an unsent broadcast, allowed for a sent one", () => {
    const none = { agents: [], campaigns: [], workflows: [] };
    const blockers = (rs: typeof rows) => deleteBlockers(usedByOf({ id: "r1", slug: "r1", broadcasts: broadcastsUsing("r1", rs) }, [], none));
    expect(blockers(rows).map((b) => [b.kind, b.name, b.href])).toEqual([["broadcast", "Follow-up Friday · 30 Oct", "/os/automations/broadcasts/fff-30-oct"]]);
    expect(blockers(rows.slice(1))).toEqual([]);
    expect(blockers([])).toEqual([]);
  });
});
