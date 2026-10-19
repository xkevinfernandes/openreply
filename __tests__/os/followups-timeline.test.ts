import { describe, expect, it } from "vitest";
import { buildTimeline, dayLabel, filterTimeline, goalOf, stepSource, timelineTab, type TimelineInput } from "@/lib/os/followups-timeline";
import type { BroadcastMessageRow } from "@/lib/os/broadcasts/types";
import type { QueuedFollowup } from "@/lib/os/sequences/view";

const TZ = "Europe/Luxembourg";
// Tue 20 Oct 2026, 09:00 local
const now = new Date("2026-10-20T07:00:00Z");

function step(over: Partial<QueuedFollowup>): QueuedFollowup {
  return {
    contactId: "c5",
    username: "priya.studio",
    fullName: null,
    avatarUrl: null,
    conversationId: "m5",
    stepId: "s1",
    sequence: "pre_call",
    sequenceTitle: "Booked, before the call",
    group: "booked",
    label: "Confirm",
    position: "Step 1 of 3",
    stepNo: 1,
    stepCount: 3,
    setterId: "j",
    timing: "day before, 16:00",
    dueAt: "2026-10-20T14:00:00Z",
    status: "QUEUED",
    intent: "Confirm time, share prep. Keep it light.",
    fixedLine: null,
    voicePhrase: null,
    resource: false,
    window: "free",
    draft: null,
    callAt: null,
    callTz: null,
    ...over,
  };
}

function bm(over: Partial<BroadcastMessageRow>): BroadcastMessageRow {
  return {
    id: "bm1",
    contactId: "c1",
    bubbles: ["btw just did this video", "https://youtu.be/x"],
    followupBubbles: [],
    status: "scheduled",
    edited: false,
    scheduledAt: "2026-10-23T08:23:11Z",
    sentAt: null,
    error: null,
    runId: "r1",
    runDate: "2026-10-23",
    broadcastKey: "follow-up-friday",
    broadcastName: "Follow-up Friday",
    ...over,
  };
}

function input(over: Partial<TimelineInput> = {}): TimelineInput {
  return {
    queue: [
      step({}),
      step({ stepId: "s2", contactId: "c8", username: "sam.creates", sequence: "no_show", stepCount: 2, dueAt: "2026-10-20T15:30:00Z", intent: "Easy rebook, no guilt" }),
      step({ stepId: "s3", contactId: "c9", username: "nora.coaching", sequence: "no_reply_lead", dueAt: "2026-10-21T08:00:00Z", intent: "Useful nudge, no pitch", fixedLine: null }),
      step({ stepId: "s4", contactId: "c6", username: "lena.fit", setterId: "nova", sequence: "no_reply_value", dueAt: "2026-10-21T12:00:00Z", status: "DRAFTED", draft: { id: "d1", bubbles: ["hey lena", "how did the reel do?"], flags: [], reasoning: null, humanAgent: false } }),
      step({ stepId: "s0", dueAt: "2026-10-19T08:00:00Z" }),
    ],
    tasks: [{ id: "t1", contactId: "c5", username: "priya.studio", fullName: null, avatarUrl: null, conversationId: "m5", title: "Send Loom to priya.studio before Thursday's call", context: { goal: null, pain: null, notes: null, lastWords: [], callAt: null } as never, status: "OPEN", createdAt: "2026-10-20T06:00:00Z" }],
    attendance: [],
    broadcasts: [bm({}), bm({ id: "bm2", contactId: "c2", status: "sent", scheduledAt: null, sentAt: "2026-10-16T09:10:00Z" }), bm({ id: "bm3", contactId: "c3", status: "drafted" })],
    needs: [{ key: "follow-up-friday", name: "Follow-up Friday", runDate: "2026-10-23", today: false, kind: "review", count: 3, windowStart: "10:00", day: "Fri", href: "/os/automations/broadcasts/follow-up-friday" }],
    sentSteps: [{ contactId: "c11", handle: "chris.makes", initial: "C", avatarUrl: null, conversationId: "m11", stepId: "x1", sequence: "no_show", setterId: "j", label: "Check in", stepNo: 1, doneAt: "2026-10-19T15:00:00Z" }],
    pausedContacts: [{ contactId: "c10", handle: "dev.hobby", initial: "D", avatarUrl: null, conversationId: "m10", setterId: "j", reason: "Follow-ups off" }],
    people: new Map([
      ["c1", { contactId: "c1", handle: "maya.builds", initial: "M", avatarUrl: null, conversationId: "m1" }],
      ["c2", { contactId: "c2", handle: "tom.k", initial: "T", avatarUrl: null, conversationId: "m2" }],
      ["c3", { contactId: "c3", handle: "jordan.ops", initial: "J", avatarUrl: null, conversationId: "m3" }],
    ]),
    setterNames: new Map([
      ["j", "J"],
      ["nova", "Nova"],
    ]),
    now,
    timeZone: TZ,
    ...over,
  };
}

describe("follow-ups timeline", () => {
  it("labels: source, goal, day", () => {
    expect(stepSource("J", "no_reply_lead", 1, 3)).toBe("J · Gone quiet · step 1/3");
    expect(stepSource("J", "no_show", 1, 2)).toBe("J · After the call: No-show · step 1/2");
    expect(goalOf("Confirm time, share prep. Keep it light.", "Confirm")).toBe("Confirm time, share prep");
    expect(goalOf("", "Value first")).toBe("Value first");
    expect(goalOf("one two three four five six seven eight", "x")).toBe("One two three four five six…");
    expect(dayLabel("2026-10-20", now, TZ)).toBe("Today");
    expect(dayLabel("2026-10-21", now, TZ)).toBe("Tomorrow");
    expect(dayLabel("2026-10-22", now, TZ)).toBe("Thu 22 Oct");
    expect(timelineTab("bogus")).toBe("scheduled");
  });

  it("Scheduled is grouped by day, overdue under Today, broadcasts on their day", () => {
    const t = buildTimeline(input());
    expect(t.scheduled.map((g) => [g.day, g.rows.length, g.banners.length])).toEqual([
      ["Today", 3, 0],
      ["Tomorrow", 2, 0],
      ["Fri 23 Oct", 1, 1],
    ]);
    const today = t.scheduled[0].rows;
    expect(today.map((r) => r.handle)).toEqual(["priya.studio", "priya.studio", "sam.creates"]);
    expect(today[1]).toMatchObject({ source: "J · Before the call · step 1/3", time: "16:00", preview: null, goal: "Confirm time, share prep", sourceHref: "/os/knowledge/j?section=followups" });
    expect(today[2].source).toBe("J · After the call: No-show · step 1/2");
    const lena = t.scheduled[1].rows.find((r) => r.handle === "lena.fit")!;
    expect(lena).toMatchObject({ source: "Nova · Gone quiet · step 1/3", ready: true, preview: "hey lena how did the reel do?", goal: null });
    const fri = t.scheduled[2];
    expect(fri.rows[0]).toMatchObject({ handle: "maya.builds", source: "Broadcast · Follow-up Friday", sourceHref: "/os/automations/broadcasts/follow-up-friday", time: "10:23", kind: "broadcast" });
    expect(fri.banners[0]).toMatchObject({ kind: "review", count: 3 });
    // drafted broadcast messages aren't scheduled yet
    expect(t.counts.scheduled).toBe(6);
  });

  it("Yours to do: tasks and broadcast needs, with where they come from", () => {
    const t = buildTimeline(input({ needs: [{ key: "follow-up-friday", name: "Follow-up Friday", runDate: "2026-10-23", today: false, kind: "link", count: 9, windowStart: "10:00", day: "Fri", href: "/os/automations/broadcasts/follow-up-friday" }] }));
    expect(t.todo.map((x) => [x.lead, x.strong, x.tail, x.due])).toEqual([
      ["Send Loom to", "priya.studio", "before Thursday's call", "Today"],
      ["Paste this week's link for", "Follow-up Friday", "", "Fri"],
    ]);
    expect(t.todo[1].action).toEqual({ label: "Add link", href: "/os/automations/broadcasts/follow-up-friday" });
    expect(t.scheduled.at(-1)!.banners[0]).toMatchObject({ kind: "link", count: 9, time: "10:00" });
  });

  it("Sent newest first, Paused, and the source filter", () => {
    const t = buildTimeline(input());
    expect(t.sent.map((s) => s.handle)).toEqual(["chris.makes", "tom.k"]);
    expect(t.paused.map((p) => [p.handle, p.reason])).toEqual([["dev.hobby", "Follow-ups off"]]);
    expect(t.sources.map((s) => s.label)).toEqual(["All sources", "J · sequences", "Nova · sequences", "Broadcasts"]);

    const nova = filterTimeline(t, "setter:nova");
    expect(nova.counts.scheduled).toBe(1);
    expect(nova.scheduled.flatMap((g) => g.banners)).toEqual([]);
    expect(nova.counts.todo).toBe(t.counts.todo);

    const bc = filterTimeline(t, "broadcasts");
    expect(bc.scheduled.map((g) => g.day)).toEqual(["Fri 23 Oct"]);
    expect(bc.sent.map((s) => s.handle)).toEqual(["tom.k"]);
    expect(filterTimeline(t, "all")).toBe(t);
  });
});
