import { describe, expect, it } from "vitest";
import { assertCanSend, capState, checkSend, localDate, localDayStart, recordSend, SendBlockedError, tzOffsetMs } from "@/lib/os/sending/cap";
import type { EventsDb } from "@/lib/os/events";
import type { SettingsDb } from "@/lib/os/workspace-settings";
import { validatePatch } from "@/lib/os/workspace-settings";

const LUX = "Europe/Luxembourg";

describe("local day boundary", () => {
  it("Luxembourg summer (UTC+2) and winter (UTC+1)", () => {
    expect(localDayStart(new Date("2026-07-10T21:59:00Z"), LUX).toISOString()).toBe("2026-07-09T22:00:00.000Z");
    expect(localDayStart(new Date("2026-07-10T22:00:00Z"), LUX).toISOString()).toBe("2026-07-10T22:00:00.000Z");
    expect(localDayStart(new Date("2026-12-10T23:30:00Z"), LUX).toISOString()).toBe("2026-12-10T23:00:00.000Z");
    expect(localDate(new Date("2026-12-10T23:30:00Z"), LUX)).toBe("2026-12-11");
  });

  it("DST change days start at the right local midnight", () => {
    // 2026-10-25: clocks go back at 03:00 local; midnight is still UTC+2.
    expect(localDayStart(new Date("2026-10-25T20:00:00Z"), LUX).toISOString()).toBe("2026-10-24T22:00:00.000Z");
    // 2026-03-29: clocks go forward at 02:00; midnight is UTC+1.
    expect(localDayStart(new Date("2026-03-29T12:00:00Z"), LUX).toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("other zones and offsets", () => {
    expect(localDayStart(new Date("2026-10-19T03:00:00Z"), "America/New_York").toISOString()).toBe("2026-10-18T04:00:00.000Z");
    expect(localDayStart(new Date("2026-10-19T03:00:00Z"), "UTC").toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(tzOffsetMs(new Date("2026-01-01T00:00:00Z"), "Asia/Kolkata")).toBe(5.5 * 3600_000);
  });
});

describe("checkSend", () => {
  it("Pause all blocks everything, the cap counts every bubble", () => {
    expect(checkSend({ sentToday: 0, cap: 80, pausedAll: true })).toBe("paused");
    expect(checkSend({ sentToday: 79, cap: 80, pausedAll: false })).toBeNull();
    expect(checkSend({ sentToday: 80, cap: 80, pausedAll: false })).toBe("cap");
    expect(checkSend({ sentToday: 78, cap: 80, pausedAll: false }, 3)).toBe("cap");
    expect(checkSend({ sentToday: 77, cap: 80, pausedAll: false }, 3)).toBeNull();
  });
});

/** Sent bubbles: a Date is one of J's (source "setter"). */
function fakeDb(settings: { sendCapPerDay?: number; pausedAll?: boolean; timezone?: string }, sent: (Date | { at: Date; source: string })[]) {
  const s = { workspaceId: "w", sendCapPerDay: 80, pausedAll: false, timezone: LUX, ...settings };
  const seenSince: Date[] = [];
  const created: object[] = [];
  const db: EventsDb & SettingsDb = {
    osWorkspace: { upsert: async () => s },
    osEvent: {
      async count({ where }) {
        const w = where as { at?: { gte?: Date }; data?: { path: string[]; equals: string } };
        const since = w.at?.gte;
        if (since) seenSince.push(since);
        return sent
          .map((x) => (x instanceof Date ? { at: x, source: "setter" } : x))
          .filter((x) => (!since || x.at >= since) && (!w.data || x.source === w.data.equals)).length;
      },
      async createMany({ data }) {
        created.push(...data);
        return { count: data.length };
      },
    },
  };
  return { db, seenSince, created };
}

describe("assertCanSend", () => {
  const now = new Date("2026-10-19T07:30:00Z"); // 09:30 in Luxembourg
  it("counts only today's sends in the workspace timezone", async () => {
    const yesterdayLate = new Date("2026-10-18T21:30:00Z"); // 23:30 local, yesterday
    const todayEarly = new Date("2026-10-18T22:30:00Z"); // 00:30 local, today
    const { db, seenSince } = fakeDb({ sendCapPerDay: 2 }, [yesterdayLate, todayEarly]);
    const s = await capState("w", { db, now });
    expect(seenSince[0].toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(s).toMatchObject({ sentToday: 1, cap: 2, remaining: 1 });
    await expect(assertCanSend("w", 1, { db, now })).resolves.toBeTruthy();
    await expect(assertCanSend("w", 2, { db, now })).rejects.toBeInstanceOf(SendBlockedError);
  });

  it("only J's sends count: workflow, opener, broadcast and manual sends don't, and aren't held by the limit", async () => {
    const t = new Date("2026-10-19T07:00:00Z");
    const others = ["workflow", "workflow", "campaign_opener", "broadcast", "manual", "voice"].map((source) => ({ at: t, source }));
    const { db } = fakeDb({ sendCapPerDay: 1 }, [...others, t]);
    const s = await capState("w", { db, now });
    expect(s).toMatchObject({ sentToday: 1, cap: 1, remaining: 0 });
    await expect(assertCanSend("w", 1, { db, now })).rejects.toMatchObject({ reason: "cap" });
    await expect(assertCanSend("w", 1, { db, now, source: "workflow" })).resolves.toBeTruthy();
    await expect(assertCanSend("w", 1, { db, now, source: "manual" })).resolves.toBeTruthy();
    expect(checkSend({ sentToday: 80, cap: 80, pausedAll: false }, 1, "workflow")).toBeNull();
    expect(checkSend({ sentToday: 80, cap: 80, pausedAll: false }, 1, "setter")).toBe("cap");
  });

  it("Pause all still blocks every source", async () => {
    const { db } = fakeDb({ pausedAll: true }, []);
    for (const source of ["setter", "workflow", "broadcast", "manual"] as const) {
      expect((await assertCanSend("w", 1, { db, now, source }).catch((e) => e)).reason).toBe("paused");
    }
    expect(checkSend({ sentToday: 0, cap: 80, pausedAll: true }, 1, "workflow")).toBe("paused");
  });

  it("Pause all throws with reason paused", async () => {
    const { db } = fakeDb({ pausedAll: true }, []);
    const err = await assertCanSend("w", 1, { db, now }).catch((e) => e);
    expect(err).toBeInstanceOf(SendBlockedError);
    expect(err.reason).toBe("paused");
    expect(err.message).toMatch(/Pause all/);
  });

  it("recordSend writes one dm_sent per call, idempotent by key", async () => {
    const { db, created } = fakeDb({}, []);
    await recordSend("w", { key: "d1:0", contactId: "c1", source: "setter", db });
    await recordSend("w", { db });
    expect(created).toHaveLength(2);
    expect(created[0]).toMatchObject({ kind: "dm_sent", dedupeKey: "dm_sent:d1:0", contactId: "c1", data: { source: "setter" } });
    expect((created[1] as { dedupeKey: string }).dedupeKey).toMatch(/^dm_sent:[0-9a-f-]{36}$/);
  });
});

describe("workspace settings patch", () => {
  it("validates the cap, Pause all and timezone", () => {
    expect(validatePatch({ sendCapPerDay: "120" })).toEqual({ patch: { sendCapPerDay: 120 } });
    expect(validatePatch({ sendCapPerDay: 0 })).toHaveProperty("error");
    expect(validatePatch({ sendCapPerDay: 2.5 })).toHaveProperty("error");
    expect(validatePatch({ sendCapPerDay: 500 })).toEqual({ patch: { sendCapPerDay: 500 } });
    expect(validatePatch({ sendCapPerDay: 501 })).toHaveProperty("error");
    expect(validatePatch({ pausedAll: "yes" })).toHaveProperty("error");
    expect(validatePatch({ timezone: "Mars/Olympus" })).toHaveProperty("error");
    expect(validatePatch({ timezone: "Europe/Luxembourg", pausedAll: true })).toEqual({ patch: { timezone: "Europe/Luxembourg", pausedAll: true } });
  });
});
