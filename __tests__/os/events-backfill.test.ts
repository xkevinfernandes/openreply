import { describe, expect, it } from "vitest";
import { backfillEvents, type BackfillRows } from "@/lib/os/metrics-backfill";

const at = (s: string) => new Date(s);

const empty: BackfillRows = { dmLogs: [], drafts: [], bookings: [], states: [], fridaySends: [], wonContacts: [] };

describe("events backfill", () => {
  it("builds every kind from existing rows with the live hooks' keys", () => {
    const events = backfillEvents(
      {
        dmLogs: [{ id: "d1", workspaceId: "w", automationId: "a1", matchedKeyword: "SETTER", createdAt: at("2026-10-01T10:00:00Z") }],
        drafts: [
          { id: "dr1", workspaceId: "w", contactId: "c1", setterId: "s1", kind: "reply", bubbles: ["here: claudepreneur.com/starter"], editedText: null, sentAt: at("2026-10-01T11:00:00Z"), decidedAt: null, createdAt: at("2026-10-01T10:30:00Z") },
          { id: "dr2", workspaceId: "w", contactId: "c1", setterId: "s1", kind: "invite", bubbles: ["want to hop on a call?"], editedText: null, sentAt: at("2026-10-02T11:00:00Z"), decidedAt: null, createdAt: at("2026-10-02T10:30:00Z") },
        ],
        bookings: [
          { id: "b1", workspaceId: "w", contactId: "c1", createdAt: at("2026-10-03T10:00:00Z"), attendance: "SHOWED", attendanceAt: at("2026-10-05T10:00:00Z"), start: at("2026-10-05T09:00:00Z") },
          { id: "b2", workspaceId: "w", contactId: "c2", createdAt: at("2026-10-03T10:00:00Z"), attendance: "NO_SHOW", attendanceAt: null, start: at("2026-10-05T09:00:00Z") },
        ],
        states: [{ workspaceId: "w", contactId: "c1", setterId: "s1", record: { opener_sent_at: "2026-10-01T10:00:05Z", their_last_at: "2026-10-01T10:20:00Z", sends: [] } }],
        fridaySends: [
          { workspaceId: "w", contactId: "c3", resourceId: "r2", status: "sent", sentAt: at("2026-10-09T10:00:00Z"), createdAt: at("2026-10-09T10:00:00Z") },
          { workspaceId: "w", contactId: "c4", resourceId: "r2", status: "sending", sentAt: null, createdAt: at("2026-10-09T10:00:00Z") },
        ],
        wonContacts: [{ id: "c1", workspaceId: "w", updatedAt: at("2026-10-06T10:00:00Z") }],
      },
      (_ws, bubbles) => (bubbles.join(" ").includes("claudepreneur.com/starter") ? ["r1"] : [])
    );
    const keys = events.map((e) => e.dedupeKey).sort();
    expect(keys).toEqual(
      [
        "call_booked:b1",
        "call_booked:b2",
        "conversation_started:c1:2026-10-01",
        "keyword_trigger:d1",
        "lead_magnet_sent:c1:r1",
        "lead_magnet_sent:c3:r2",
        "offer_made:dr2",
        "showed:b1",
        "won:c1",
      ].sort()
    );
    expect(events.find((e) => e.kind === "showed")!.at).toEqual(at("2026-10-05T10:00:00Z"));
  });

  it("uses what was actually sent when Kevin edited the draft", () => {
    const events = backfillEvents(
      {
        ...empty,
        drafts: [{ id: "dr1", workspaceId: "w", contactId: "c1", setterId: null, kind: "reply", bubbles: ["no link"], editedText: "claudepreneur.com/vault", sentAt: null, decidedAt: null, createdAt: at("2026-10-01T10:00:00Z") }],
      },
      (_ws, b) => (b.join(" ").includes("vault") ? ["r2"] : [])
    );
    expect(events.map((e) => e.dedupeKey)).toEqual(["lead_magnet_sent:c1:r2"]);
  });

  it("skips junk state records", () => {
    expect(backfillEvents({ ...empty, states: [{ workspaceId: "w", contactId: "c", setterId: null, record: null }] }, () => [])).toEqual([]);
  });
});
