import { describe, expect, it } from "vitest";
import { excludedReason, selectAudience, stillInWindow } from "@/lib/os/broadcasts/audience";
import type { BroadcastContact } from "@/lib/os/broadcasts/types";

const H = 3_600_000;
const from = new Date("2026-10-23T08:00:00Z");
const until = new Date("2026-10-23T13:00:00Z");
const ago = (h: number) => new Date(from.getTime() - h * H).toISOString();

function c(id: string, over: Partial<BroadcastContact> = {}): BroadcastContact {
  return {
    contactId: id,
    username: id,
    fullName: null,
    kind: "SALES",
    paused: false,
    tags: ["follow-up-friday"],
    igUserId: id,
    conversationId: `conv-${id}`,
    theirLastAt: ago(2),
    ourLastAt: ago(1),
    setterStage: null,
    stage: null,
    notes: null,
    fields: [],
    ...over,
  };
}

describe("broadcast audience", () => {
  it("tagged contacts inside the 24h window are eligible, with a deadline", () => {
    const r = selectAudience([c("a"), c("b", { theirLastAt: ago(20) })], { tag: "follow-up-friday", from, until });
    expect(r.eligible.map((e) => e.contact.contactId)).toEqual(["b", "a"]); // the earlier deadline first
    // b wrote 20h before the window: 24h - 1h safety → closes 3h in
    expect(r.eligible[0].deadline).toBe(new Date(from.getTime() + 3 * H).toISOString());
    // a's window outlasts the send window: capped at its end
    expect(r.eligible[1].deadline).toBe(until.toISOString());
  });

  it("outside the window is listed and skipped, never HUMAN_AGENT", () => {
    const r = selectAudience([c("old", { theirLastAt: ago(30) }), c("never", { theirLastAt: null }), c("edge", { theirLastAt: ago(23.5) })], { tag: "follow-up-friday", from, until });
    expect(r.eligible).toHaveLength(0);
    expect(r.outside.map((e) => e.contact.contactId).sort()).toEqual(["edge", "never", "old"]);
    expect(r.outside.find((e) => e.contact.contactId === "never")?.reason).toBe("Never wrote to you");
  });

  it("only the tag; paused, Personal and Pitches never get it", () => {
    const r = selectAudience(
      [c("untagged", { tags: ["hot"] }), c("p", { paused: true }), c("friend", { kind: "PERSONAL" }), c("pitch", { kind: "PITCHES" }), c("u", { kind: "UNSORTED" }), c("case", { tags: ["Follow-Up-Friday"] })],
      { tag: "follow-up-friday", from, until }
    );
    expect(r.eligible.map((e) => e.contact.contactId).sort()).toEqual(["case", "u"]);
    expect(r.excluded.map((e) => [e.contact.contactId, e.reason])).toEqual([
      ["friend", "Personal"],
      ["p", "Paused"],
      ["pitch", "Pitches"],
    ]);
  });

  it("Pause all sends to nobody", () => {
    const r = selectAudience([c("a"), c("b")], { tag: "follow-up-friday", from, until, pausedAll: true });
    expect(r.eligible).toHaveLength(0);
    expect(r.excluded.every((e) => e.reason === "Pause all is on")).toBe(true);
  });

  it("excludedReason and the send-time window re-check", () => {
    expect(excludedReason({ kind: "SALES", paused: false })).toBeNull();
    expect(stillInWindow(ago(2), from)).toBe(true);
    expect(stillInWindow(ago(23.5), from)).toBe(false);
    expect(stillInWindow(null, from)).toBe(false);
  });
});
