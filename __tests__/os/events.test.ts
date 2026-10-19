import { describe, expect, it } from "vitest";
import { countEvents, eventKey, recordEvent, recordEventQuietly, recordEvents, type EventsDb } from "@/lib/os/events";
import { draftSentEvents } from "@/lib/os/events-hooks";

/** In-memory osEvent with Postgres' skipDuplicates on the unique dedupeKey. */
function fakeDb() {
  const rows: { dedupeKey: string; kind: string; workspaceId: string; at: Date }[] = [];
  const db: EventsDb = {
    osEvent: {
      async createMany({ data, skipDuplicates }) {
        let count = 0;
        for (const r of data as typeof rows) {
          if (rows.some((x) => x.dedupeKey === r.dedupeKey)) {
            if (!skipDuplicates) throw new Error("unique violation");
            continue;
          }
          rows.push(r);
          count++;
        }
        return { count };
      },
      async count({ where }) {
        const w = where as { workspaceId: string; kind: string; at?: { gte?: Date; lt?: Date } };
        return rows.filter((r) => r.workspaceId === w.workspaceId && r.kind === w.kind && (!w.at?.gte || r.at >= w.at.gte) && (!w.at?.lt || r.at < w.at.lt)).length;
      },
    },
  };
  return { db, rows };
}

describe("OsEvent dedupe", () => {
  it("the same dedupeKey counts once, across calls and inside one batch", async () => {
    const { db, rows } = fakeDb();
    const e = { workspaceId: "w", kind: "call_booked" as const, dedupeKey: eventKey("call_booked", "b1") };
    expect(await recordEvent(e, db)).toBe(true);
    expect(await recordEvent(e, db)).toBe(false);
    expect(await recordEvents([e, { ...e, dedupeKey: "call_booked:b2" }, { ...e, dedupeKey: "call_booked:b2" }], db)).toBe(1);
    expect(rows.map((r) => r.dedupeKey)).toEqual(["call_booked:b1", "call_booked:b2"]);
  });

  it("rejects unknown kinds; the quiet variant logs instead of throwing", async () => {
    const { db } = fakeDb();
    await expect(recordEvent({ workspaceId: "w", kind: "nope" as never, dedupeKey: "x" }, db)).rejects.toThrow(/Unknown event kind/);
    const broken: EventsDb = { osEvent: { createMany: async () => Promise.reject(new Error("db down")), count: async () => 0 } };
    const err = console.error;
    console.error = () => {};
    try {
      expect(await recordEventQuietly({ workspaceId: "w", kind: "won", dedupeKey: "won:c1" }, broken)).toBe(false);
    } finally {
      console.error = err;
    }
  });

  it("eventKey joins parts and needs at least one", () => {
    expect(eventKey("lead_magnet_sent", "c1", "r1")).toBe("lead_magnet_sent:c1:r1");
    expect(eventKey("won", "c1", null, undefined, "")).toBe("won:c1");
    expect(() => eventKey("won")).toThrow();
  });

  it("countEvents filters by time range", async () => {
    const { db } = fakeDb();
    const at = (iso: string) => new Date(iso);
    await recordEvents(
      [
        { workspaceId: "w", kind: "dm_sent", dedupeKey: "a", at: at("2026-10-18T10:00:00Z") },
        { workspaceId: "w", kind: "dm_sent", dedupeKey: "b", at: at("2026-10-19T10:00:00Z") },
        { workspaceId: "v", kind: "dm_sent", dedupeKey: "c", at: at("2026-10-19T10:00:00Z") },
      ],
      db
    );
    expect(await countEvents("w", "dm_sent", { since: at("2026-10-19T00:00:00Z") }, db)).toBe(1);
    expect(await countEvents("w", "dm_sent", {}, db)).toBe(2);
  });
});

describe("draftSentEvents", () => {
  const base = { workspaceId: "w", contactId: "c1", setterId: "s1", draftId: "d1", bubbles: ["hi"], at: new Date("2026-10-19T09:00:00Z") };
  it("an invite or booking is an offer; plain replies are not", () => {
    expect(draftSentEvents({ ...base, kind: "invite" }, []).map((e) => e.dedupeKey)).toEqual(["offer_made:d1"]);
    expect(draftSentEvents({ ...base, kind: "booking" }, []).map((e) => e.kind)).toEqual(["offer_made"]);
    expect(draftSentEvents({ ...base, kind: "reply" }, [])).toEqual([]);
  });

  it("a lead magnet counts once per person, whichever draft resends it", () => {
    const a = draftSentEvents({ ...base, kind: "reply" }, ["r1"]);
    const b = draftSentEvents({ ...base, draftId: "d2", kind: "nudge" }, ["r1"]);
    expect(a[0].dedupeKey).toBe("lead_magnet_sent:c1:r1");
    expect(b[0].dedupeKey).toBe(a[0].dedupeKey);
  });
});
