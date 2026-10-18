import { describe, expect, it } from "vitest";
import {
  dueCount,
  fridayFor,
  fridaySendProblem,
  isFriday,
  pickResource,
  resourcesHad,
  selectFriday,
  selectNudges,
  timerAnchor,
  type FridayContact,
  type FridayResource,
  type QueueContact,
  type QueueDraft,
} from "../../lib/os/followups";
import { closingWindows, countBars, J_STAGES } from "../../lib/os/home";
import { iso, newRecord, type SetterRecord } from "../../lib/os/setter/state";

const NOW = new Date("2026-10-21T12:00:00Z"); // a Wednesday
const h = (hours: number) => iso(new Date(NOW.getTime() + hours * 3600_000));

function rec(over: Partial<SetterRecord> = {}): SetterRecord {
  return { ...newRecord("conv", "sam", "c1"), their_last_at: h(-10), our_last_at: h(-7), ...over };
}

function contact(over: Partial<QueueContact> = {}): QueueContact {
  return {
    contactId: "c1",
    username: "sam",
    fullName: null,
    avatarUrl: null,
    conversationId: "conv",
    kind: "SALES",
    paused: false,
    tags: [],
    state: "in_conversation",
    nextActionKind: "nudge",
    nextActionAt: h(-1),
    snoozedUntil: null,
    record: rec(),
    ...over,
  };
}

function draft(over: Partial<QueueDraft> = {}): QueueDraft {
  return {
    id: "d1",
    contactId: "c1",
    kind: "nudge",
    bubbles: ["hey"],
    flags: [],
    setterStage: null,
    reasoning: null,
    humanAgent: false,
    createdAt: h(-0.5)!,
    ...over,
  };
}

describe("selectNudges", () => {
  it("lists a due nudge with J's anchor", () => {
    const [item] = selectNudges([contact()], [], NOW);
    expect(item.status).toBe("due");
    expect(item.kind).toBe("nudge");
    expect(item.anchor).toBe(`nudge:${h(-7)}`);
    expect(item.window).toBe("free");
  });

  it("marks timers within 24h as soon and drops later ones", () => {
    const items = selectNudges(
      [contact({ contactId: "a", nextActionAt: h(5) }), contact({ contactId: "b", nextActionAt: h(30) })],
      [],
      NOW
    );
    expect(items.map((i) => [i.contactId, i.status])).toEqual([["a", "soon"]]);
  });

  it("includes value openers, ignores reply timers", () => {
    const items = selectNudges(
      [
        contact({ contactId: "a", nextActionKind: "value_opener", record: rec({ delivered_at: h(-2) }) }),
        contact({ contactId: "b", nextActionKind: "reply" }),
      ],
      [],
      NOW
    );
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("value_opener");
    expect(items[0].anchor).toBe(`opener:${h(-2)}`);
  });

  it("puts pending nudge drafts first, even without a due timer", () => {
    const items = selectNudges(
      [contact({ contactId: "a", nextActionAt: h(-3) }), contact({ contactId: "b", nextActionKind: null, nextActionAt: null })],
      [draft({ contactId: "b" })],
      NOW
    );
    expect(items.map((i) => [i.contactId, i.status])).toEqual([
      ["b", "drafted"],
      ["a", "due"],
    ]);
    expect(items[0].draft?.id).toBe("d1");
  });

  it("leaves reply and invitation drafts to the Inbox", () => {
    expect(selectNudges([contact()], [draft({ kind: "reply" })], NOW)).toEqual([]);
    expect(selectNudges([contact()], [draft({ kind: "invite" })], NOW)).toEqual([]);
  });

  it("hides snoozed contacts until the snooze ends", () => {
    expect(selectNudges([contact({ snoozedUntil: h(2) })], [], NOW)).toEqual([]);
    expect(selectNudges([contact({ snoozedUntil: h(-1) })], [], NOW)).toHaveLength(1);
    expect(selectNudges([contact({ snoozedUntil: h(2) })], [draft()], NOW)).toEqual([]);
  });

  it("drops skipped anchors, paused, non-sales, frozen tags and closed windows", () => {
    const skipped = rec({ skipped_anchors: [`nudge:${h(-7)}`] });
    expect(selectNudges([contact({ record: skipped })], [], NOW)).toEqual([]);
    expect(selectNudges([contact({ paused: true })], [], NOW)).toEqual([]);
    expect(selectNudges([contact({ kind: "PERSONAL" })], [], NOW)).toEqual([]);
    expect(selectNudges([contact({ tags: ["client"] })], [], NOW)).toEqual([]);
    expect(selectNudges([contact({ state: "not_now" })], [], NOW)).toEqual([]);
    expect(selectNudges([contact({ record: rec({ their_last_at: h(-24 * 8) }) })], [], NOW)).toEqual([]);
  });

  it("flags the HUMAN_AGENT window", () => {
    const [item] = selectNudges([contact({ record: rec({ their_last_at: h(-30), our_last_at: h(-8) }) })], [], NOW);
    expect(item.window).toBe("human_agent");
  });

  it("timerAnchor needs the timestamp it is built from", () => {
    expect(timerAnchor("nudge", rec({ our_last_at: null }))).toBeNull();
    expect(timerAnchor("value_opener", null)).toBeNull();
  });
});

const RES: FridayResource[] = [
  { id: "r1", slug: "a", name: "A", link: "https://x/a", status: "ACTIVE" },
  { id: "r2", slug: "b", name: "B", link: null, status: "ACTIVE" },
  { id: "r3", slug: "c", name: "C", link: "https://x/c", status: "TEST" },
  { id: "r4", slug: "d", name: "D", link: "https://x/d", status: "ACTIVE" },
];

function fc(over: Partial<FridayContact> = {}): FridayContact {
  return {
    contactId: "c1",
    username: "sam",
    fullName: null,
    avatarUrl: null,
    conversationId: "conv",
    tags: [],
    state: "in_conversation",
    record: rec({ their_last_at: h(-3) }),
    ...over,
  };
}

describe("Friday", () => {
  it("fridayFor: the coming Friday, or today on a Friday", () => {
    expect(fridayFor(NOW)).toBe("2026-10-23");
    expect(fridayFor(new Date("2026-10-23T08:00:00Z"))).toBe("2026-10-23");
    expect(fridayFor(new Date("2026-10-24T08:00:00Z"))).toBe("2026-10-30");
    expect(isFriday(new Date("2026-10-23T08:00:00Z"))).toBe(true);
    expect(isFriday(NOW)).toBe(false);
    // Late Thursday UTC is already Friday in Luxembourg.
    expect(isFriday(new Date("2026-10-22T22:30:00Z"))).toBe(true);
  });

  it("resourcesHad joins the thread, sent: tags and the Friday log", () => {
    const had = resourcesHad(rec({ resources_sent: ["a"] }), ["sent:b", "hot"], [
      { contactId: "c1", resourceSlug: "d", friday: "2026-10-16", status: "sent", sentAt: null },
    ]);
    expect(had).toEqual(["a", "b", "d"]);
  });

  it("pickResource: first active one with a link they haven't had", () => {
    expect(pickResource(RES, [])?.slug).toBe("a");
    expect(pickResource(RES, ["a"])?.slug).toBe("d");
    expect(pickResource(RES, ["a", "d"])).toBeNull();
  });

  it("a ready person gets the next resource", () => {
    const [item] = selectFriday([fc({ record: rec({ their_last_at: h(-3), resources_sent: ["a"] }) })], RES, [], NOW);
    expect(item.status).toBe("ready");
    expect(item.suggested).toBe("d");
    expect(item.window).toBe("free");
  });

  it("this Friday's send shows as sent and sorts last", () => {
    const items = selectFriday([fc({ contactId: "x" }), fc({ contactId: "y" })], RES, [
      { contactId: "x", resourceSlug: "a", friday: "2026-10-23", status: "sent", sentAt: h(-1) },
    ], NOW);
    expect(items.map((i) => [i.contactId, i.status])).toEqual([
      ["y", "ready"],
      ["x", "sent"],
    ]);
    expect(items[1].sent).toEqual({ slug: "a", at: h(-1) });
  });

  it("blocks stop tags, stop states and a gift within 7 days", () => {
    expect(selectFriday([fc({ tags: ["client"] })], RES, [], NOW)[0].status).toBe("blocked");
    expect(selectFriday([fc({ tags: ["booked"] })], RES, [], NOW)[0].reason).toBe("Tagged booked");
    expect(selectFriday([fc({ state: "frozen" })], RES, [], NOW)[0].status).toBe("blocked");
    const recent = selectFriday([fc({ record: rec({ their_last_at: h(-3), friday_last_at: h(-48) }) })], RES, [], NOW)[0];
    expect(recent.status).toBe("blocked");
    expect(recent.reason).toBe("Had a resource 2 days ago");
    const old = selectFriday([fc({ record: rec({ their_last_at: h(-3), friday_last_at: h(-24 * 8) }) })], RES, [], NOW)[0];
    expect(old.status).toBe("ready");
  });

  it("a closed window is email only; no record means unknown", () => {
    expect(selectFriday([fc({ record: rec({ their_last_at: h(-24 * 9) }) })], RES, [], NOW)[0].status).toBe("email_only");
    const [unknown] = selectFriday([fc({ record: null })], RES, [], NOW);
    expect(unknown.window).toBe("unknown");
    expect(unknown.status).toBe("ready");
  });

  it("nothing left when they had every resource", () => {
    const [item] = selectFriday([fc({ tags: ["sent:a", "sent:d"] })], RES, [], NOW);
    expect(item.status).toBe("nothing_left");
  });

  it("fridaySendProblem refuses duplicates", () => {
    const [item] = selectFriday([fc({ tags: ["sent:a"] })], RES, [], NOW);
    expect(fridaySendProblem(item, "a")).toBe("They already had that one.");
    expect(fridaySendProblem(item, "d")).toBeNull();
  });

  it("dueCount: ready/due nudges, plus the Friday list only on Friday", () => {
    const nudges = selectNudges([contact({ contactId: "a" }), contact({ contactId: "b", nextActionAt: h(4) })], [], NOW);
    const friday = selectFriday([fc()], RES, [], NOW);
    expect(dueCount(nudges, friday, false)).toBe(1);
    expect(dueCount(nudges, friday, true)).toBe(2);
  });
});

describe("Home setter numbers", () => {
  it("closingWindows counts threads they wrote last with the free window open", () => {
    const r = closingWindows(
      [
        { theirLastAt: h(-2), ourLastAt: h(-5) },
        { theirLastAt: h(-20), ourLastAt: null },
        { theirLastAt: h(-2), ourLastAt: h(-1) }, // we answered
        { theirLastAt: h(-30), ourLastAt: null }, // past 24h
      ],
      NOW
    );
    expect(r.count).toBe(2);
    expect(r.nextClose).toBe(h(-20 + 23));
  });

  it("countBars keeps J's stage order and zeroes", () => {
    const bars = countBars(J_STAGES, ["qualify", "opener", "qualify", null, "weird"]);
    expect(bars.map((b) => b.count)).toEqual([1, 0, 0, 2, 0, 0]);
    expect(bars[0].label).toBe("Opener");
  });
});
