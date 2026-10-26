// The one stage writer (dm-crm issues 002/003): the move table, the log, the
// Won rule and the hook, against an in-memory store. The row lock and two
// concurrent writes are tested on a real Postgres in
// stage-writer.migrations.test.ts.
import { describe, expect, it } from "vitest";
import type { ContactStage } from "@/app/generated/prisma/enums";
import { funnelColumns } from "@/lib/os/funnel";
import {
  decideMove,
  moveTargets,
  writeAttendance,
  writeStage,
  type Attendance,
  type StageCause,
  type StageChange,
  type StageDb,
  type StageLogRow,
  type StageState,
} from "@/lib/os/stage-writer";

const columns = funnelColumns(null); // open value permission qualify assure book | booked showed no_show won lost

interface Contact {
  stage: ContactStage;
  setterStage: string | null;
  bookings: { id: string; status: string; attendance: Attendance | null }[];
  won: { amount?: number; offer?: string } | null;
}

function fakeDb(start: Partial<Contact> = {}) {
  const c: Contact = { stage: "IN_CONVERSATION", setterStage: "open", bookings: [], won: null, ...start };
  const log: StageLogRow[] = [];
  const state = (): StageState => ({
    stage: c.stage,
    setterStage: c.setterStage,
    setterId: "set1",
    attendance: [...c.bookings].reverse().find((b) => b.attendance)?.attendance ?? null,
    liveBooking: c.bookings.some((b) => b.status !== "CANCELLED"),
    columns,
  });
  const db: StageDb = {
    async run(fn) {
      return fn({
        lock: async (_w, id) => (id === "c1" ? state() : null),
        update: async (_w, _id, data) => void Object.assign(c, data),
        setAttendance: async (_w, bookingId, data) => {
          const b = c.bookings.find((x) => x.id === bookingId);
          if (!b) return null;
          b.attendance = data.attendance;
          return "c1";
        },
        clearWon: async () => void (c.won = c.won ? {} : null),
        refusedSinceApplied: async () => {
          const i = [...log].reverse().findIndex((r) => r.outcome === "applied");
          const since = i < 0 ? log : log.slice(log.length - i);
          return since.filter((r) => r.outcome === "refused").map((r) => ({ cause: r.cause, toColumn: r.toColumn }));
        },
        log: async (row) => void log.push(row),
      });
    },
    bookingContact: async (_w, bookingId) => (c.bookings.some((b) => b.id === bookingId) ? "c1" : null),
  };
  const hooks: { stage: ContactStage }[] = [];
  const write = (cause: StageCause, change: StageChange) =>
    writeStage({ workspaceId: "w1", contactId: "c1", cause, change }, { db, onStageChanged: async (i) => void hooks.push({ stage: i.stage }) });
  return { c, log, db, hooks, write };
}

describe("the move table (user, sequence, automation, import)", () => {
  it("setter stage → another setter stage writes the hint and logs one applied row", async () => {
    const t = fakeDb();
    expect(await t.write("user", { type: "column", column: "qualify" })).toMatchObject({ status: "applied", from: "open", to: "qualify", logged: true });
    expect(t.c).toMatchObject({ stage: "IN_CONVERSATION", setterStage: "qualify" });
    expect(t.log).toEqual([expect.objectContaining({ fromColumn: "open", toColumn: "qualify", outcome: "applied", cause: "user", setterId: "set1" })]);
    expect(t.hooks).toEqual([]); // the stage itself didn't change
  });

  it("→ Won writes stage = won and fires the stage-changed hook", async () => {
    const t = fakeDb();
    expect((await t.write("user", { type: "column", column: "won" })).status).toBe("applied");
    expect(t.c.stage).toBe("WON");
    expect(t.hooks).toEqual([{ stage: "WON" }]);
  });

  it("any column → Lost; leaving Won clears the won data", async () => {
    const t = fakeDb({ stage: "WON", won: { amount: 900, offer: "Coaching" } });
    expect((await t.write("user", { type: "column", column: "lost" })).status).toBe("applied");
    expect(t.c.stage).toBe("LOST");
    expect(t.c.won).toEqual({});
  });

  it("Won/Lost → a setter stage re-opens, only without call attendance", async () => {
    const open = fakeDb({ stage: "LOST" });
    expect((await open.write("user", { type: "column", column: "value" })).status).toBe("applied");
    expect(open.c).toMatchObject({ stage: "IN_CONVERSATION", setterStage: "value" });

    const showed = fakeDb({ stage: "LOST", bookings: [{ id: "b1", status: "BOOKED", attendance: "SHOWED" }] });
    expect(await showed.write("user", { type: "column", column: "value" })).toMatchObject({ status: "refused" });
    expect(showed.c.stage).toBe("LOST");
    expect(showed.log).toEqual([expect.objectContaining({ outcome: "refused", toColumn: "value" })]);
  });

  it("nothing moves into Booked, Showed or No-show: those come from the booking", async () => {
    for (const col of ["booked", "showed", "no_show"]) {
      for (const cause of ["user", "sequence", "automation", "import"] as const) {
        const t = fakeDb();
        expect(await t.write(cause, { type: "column", column: col })).toMatchObject({ status: "refused", reason: "Set from the booking." });
        expect(t.c).toMatchObject({ stage: "IN_CONVERSATION", setterStage: "open" });
      }
    }
    // A raw stage write to CALL_BOOKED by an import is refused the same way.
    const imp = fakeDb();
    expect((await imp.write("import", { type: "stage", stage: "CALL_BOOKED" })).status).toBe("refused");
  });

  it("Booked → a setter stage: refused with a booking row, allowed without one", async () => {
    const withRow = fakeDb({ stage: "CALL_BOOKED", bookings: [{ id: "b1", status: "BOOKED", attendance: null }] });
    expect(await withRow.write("user", { type: "column", column: "qualify" })).toMatchObject({ status: "refused", reason: "Change the booking instead." });
    const noRow = fakeDb({ stage: "CALL_BOOKED" });
    expect((await noRow.write("user", { type: "column", column: "qualify" })).status).toBe("applied");
    expect(noRow.c).toMatchObject({ stage: "IN_CONVERSATION", setterStage: "qualify" });
  });

  it("Booked / Showed / No-show → Won or Lost leaves the booking alone", async () => {
    const t = fakeDb({ stage: "CALL_BOOKED", bookings: [{ id: "b1", status: "BOOKED", attendance: "NO_SHOW" }] });
    expect((await t.write("user", { type: "column", column: "lost" })).status).toBe("applied");
    expect(t.c.bookings[0]).toEqual({ id: "b1", status: "BOOKED", attendance: "NO_SHOW" });
  });

  it("a repeated identical refusal leaves one row; an applied move resets that", async () => {
    const t = fakeDb({ stage: "CALL_BOOKED", bookings: [{ id: "b1", status: "BOOKED", attendance: null }] });
    for (let i = 0; i < 3; i++) await t.write("sequence", { type: "column", column: "qualify" });
    expect(t.log.filter((r) => r.outcome === "refused")).toHaveLength(1);
    await t.write("sequence", { type: "column", column: "value" }); // different target: its own row
    expect(t.log.filter((r) => r.outcome === "refused")).toHaveLength(2);
    await t.write("user", { type: "column", column: "won" });
    await t.write("user", { type: "column", column: "lost" });
    await t.write("sequence", { type: "column", column: "booked" });
    await t.write("sequence", { type: "column", column: "booked" });
    expect(t.log.filter((r) => r.outcome === "refused" && r.toColumn === "booked")).toHaveLength(1);
  });

  it("a write without a cause is refused outright", async () => {
    const t = fakeDb();
    await expect(writeStage({ workspaceId: "w1", contactId: "c1", cause: "" as StageCause, change: { type: "column", column: "won" } }, { db: t.db })).rejects.toThrow(/cause/);
    expect(t.log).toEqual([]);
  });

  it("no manual lock: a user move followed by a setter, sequence or automation move applies both", async () => {
    const t = fakeDb();
    await t.write("user", { type: "column", column: "qualify" });
    expect((await t.write("setter", { type: "setterStage", setterStage: "assure" })).status).toBe("applied");
    expect((await t.write("sequence", { type: "column", column: "book" })).status).toBe("applied");
    expect((await t.write("automation", { type: "column", column: "lost" })).status).toBe("applied");
    expect(t.log.map((r) => [r.cause, r.toColumn])).toEqual([
      ["user", "qualify"],
      ["setter", "assure"],
      ["sequence", "book"],
      ["automation", "lost"],
    ]);
  });
});

describe("only Kevin takes someone off Won", () => {
  it("setter, sequence, automation and import writes off Won are refused and logged", async () => {
    const cases: [StageCause, StageChange][] = [
      ["setter", { type: "stage", stage: "LOST" }],
      ["sequence", { type: "column", column: "lost" }],
      ["automation", { type: "column", column: "qualify" }],
      ["import", { type: "stage", stage: "IN_CONVERSATION" }],
    ];
    for (const [cause, change] of cases) {
      const t = fakeDb({ stage: "WON", won: { amount: 500 } });
      expect(await t.write(cause, change)).toMatchObject({ status: "refused", reason: "Only Kevin takes someone off Won." });
      expect(t.c.stage).toBe("WON");
      expect(t.c.won).toEqual({ amount: 500 });
      expect(t.log).toEqual([expect.objectContaining({ outcome: "refused", cause })]);
    }
  });

  it("a booking write on a Won contact: the stage part is refused, attendance still updates", async () => {
    const t = fakeDb({ stage: "WON", bookings: [{ id: "b1", status: "BOOKED", attendance: null }] });
    expect(await t.write("booking", { type: "stage", stage: "CALL_BOOKED", setterStage: "booked" })).toMatchObject({ status: "refused" });
    expect(t.c.stage).toBe("WON");
    await writeAttendance({ workspaceId: "w1", bookingId: "b1", attendance: "SHOWED", source: "calcom" }, { db: t.db, onStageChanged: null });
    expect(t.c.bookings[0].attendance).toBe("SHOWED");
    expect(t.c.stage).toBe("WON");
  });

  it("J's hint on a Won contact is written (the card stays on Won)", async () => {
    const t = fakeDb({ stage: "WON" });
    expect((await t.write("setter", { type: "setterStage", setterStage: "assure" })).status).toBe("applied");
    expect(t.c).toMatchObject({ stage: "WON", setterStage: "assure" });
    expect(t.log).toEqual([]);
  });

  it("Undo Won: Booked with a live booking, else in conversation on its hint; clears won data", async () => {
    const booked = fakeDb({ stage: "WON", setterStage: "assure", bookings: [{ id: "b1", status: "CONFIRMED", attendance: null }], won: { amount: 1 } });
    expect(await booked.write("user", { type: "undoWon" })).toMatchObject({ status: "applied", to: "booked" });
    expect(booked.c).toMatchObject({ stage: "CALL_BOOKED", won: {} });
    const none = fakeDb({ stage: "WON", setterStage: "assure" });
    expect(await none.write("user", { type: "undoWon" })).toMatchObject({ status: "applied", to: "assure" });
    expect(none.c.stage).toBe("IN_CONVERSATION");
    expect((await fakeDb({ stage: "WON" }).write("setter", { type: "undoWon" })).status).toBe("refused");
  });
});

describe("booking and setter causes write what they always wrote", () => {
  it("booking confirm moves Lost / not qualified → Booked", async () => {
    for (const stage of ["LOST", "NOT_QUALIFIED"] as const) {
      const t = fakeDb({ stage, bookings: [{ id: "b1", status: "BOOKED", attendance: null }] });
      expect(await t.write("booking", { type: "stage", stage: "CALL_BOOKED", setterStage: "booked" })).toMatchObject({ status: "applied", to: "booked" });
      expect(t.c).toMatchObject({ stage: "CALL_BOOKED", setterStage: "booked" });
      expect(t.log[0]).toMatchObject({ cause: "booking", fromColumn: "lost", toColumn: "booked" });
    }
  });

  it("attendance moves the card and logs it with cause booking", async () => {
    const t = fakeDb({ stage: "CALL_BOOKED", bookings: [{ id: "b1", status: "BOOKED", attendance: null }] });
    expect(await writeAttendance({ workspaceId: "w1", bookingId: "b1", attendance: "NO_SHOW", source: "calcom" }, { db: t.db, onStageChanged: null })).toMatchObject({
      status: "applied",
      from: "booked",
      to: "no_show",
    });
    expect(t.log[0]).toMatchObject({ cause: "booking", toColumn: "no_show" });
    expect((await writeAttendance({ workspaceId: "w1", bookingId: "nope", attendance: null }, { db: t.db })).status).toBe("missing");
  });

  it("J's hint lands where columnFor puts it (booked-like hints in Booked)", async () => {
    const t = fakeDb();
    expect(await t.write("setter", { type: "setterStage", setterStage: "booked" })).toMatchObject({ status: "applied", to: "booked" });
  });
});

describe("moveTargets (board drop targets, the panel's dropdown)", () => {
  it("offers exactly the moves the table allows", () => {
    const s: StageState = { stage: "CALL_BOOKED", setterStage: "booked", setterId: null, attendance: null, liveBooking: true, columns };
    const t = moveTargets(s);
    expect(t.filter((x) => x.allowed).map((x) => x.key)).toEqual(["won", "lost"]);
    expect(t.find((x) => x.key === "showed")?.reason).toBe("Set from the booking.");
    expect(t.find((x) => x.key === "qualify")?.reason).toBe("Change the booking instead.");
    expect(decideMove({ ...s, stage: "IN_CONVERSATION", setterStage: "open", liveBooking: false }, { type: "column", column: "nope" }, "user")).toMatchObject({ kind: "refuse", reason: "Unknown column." });
  });
});

describe("OS_MOCK", () => {
  it("moves a sample contact and logs it in memory", async () => {
    const { mockStageDb } = await import("@/lib/os/stage-writer-mock");
    const { mockContact } = await import("@/lib/os/mock");
    const { mockStageLog } = await import("@/lib/os/mock-crm");
    const r = await writeStage({ workspaceId: "ws", contactId: "c2", cause: "user", change: { type: "column", column: "qualify" } }, { db: mockStageDb(), onStageChanged: null });
    expect(r).toMatchObject({ status: "applied", to: "qualify" });
    expect(mockContact("c2")?.contact.setterStage).toBe("qualify");
    expect(mockStageLog("c2")[0]).toMatchObject({ cause: "user", toColumn: "qualify", outcome: "applied" });
    expect((await writeStage({ workspaceId: "ws", contactId: "c2", cause: "user", change: { type: "column", column: "booked" } }, { db: mockStageDb(), onStageChanged: null })).status).toBe("refused");
  });
});
