// OS_MOCK=1 storage for the stage writer (lib/os/stage-writer.ts): the sample
// contacts in lib/os/mock.ts, bookings in the mock booking store, and the
// stage log in lib/os/mock-crm.ts. Same move table, no database.

import type { ContactStage } from "@/app/generated/prisma/enums";
import { funnelColumns } from "@/lib/os/funnel";
import { mockContact, updateMockContact } from "@/lib/os/mock";
import { appendMockStageLog, mockStageLog } from "@/lib/os/mock-crm";
import { mockBookingRows } from "@/lib/os/setter/booking-store";
import type { Attendance, StageDb, StageTx } from "@/lib/os/stage-writer";

/** The sample's no-show (contacts board sample: Sam missed the call). */
const SAMPLE_ATTENDANCE: Record<string, Attendance> = { c8: "NO_SHOW" };

let chain: Promise<unknown> = Promise.resolve();

const tx: StageTx = {
  async lock(_workspaceId, contactId) {
    const c = mockContact(contactId);
    if (!c) return null;
    const rows = [...mockBookingRows().values()].filter((b) => b.contactId === contactId);
    const att = [...rows].reverse().find((b) => b.attendance)?.attendance ?? SAMPLE_ATTENDANCE[contactId] ?? null;
    return {
      stage: c.contact.stage as ContactStage,
      setterStage: c.contact.setterStage ?? null,
      setterId: null,
      attendance: att,
      liveBooking: rows.some((b) => b.status !== "CANCELLED"),
      columns: funnelColumns(null),
    };
  },
  async update(_workspaceId, contactId, data) {
    updateMockContact(contactId, data as { stage?: ContactStage; setterStage?: string | null });
  },
  async setAttendance(_workspaceId, bookingId, data) {
    const b = mockBookingRows().get(bookingId);
    if (!b) return null;
    Object.assign(b, { attendance: data.attendance, attendanceSource: data.attendance ? data.source : null, attendanceAt: data.at?.toISOString() ?? null });
    return b.contactId;
  },
  async clearWon(contactId) {
    // Sample won amounts live with the Won picker's own mock (no event log here).
    (await import("@/lib/os/mock-contacts-crm")).mockClearWon(contactId);
  },
  async refusedSinceApplied(contactId) {
    const rows = mockStageLog(contactId);
    const i = rows.findIndex((r) => r.outcome === "applied");
    return (i < 0 ? rows : rows.slice(0, i)).filter((r) => r.outcome === "refused").map((r) => ({ cause: r.cause, toColumn: r.toColumn }));
  },
  async log(row) {
    appendMockStageLog({ ...row, at: row.at.toISOString() });
  },
};

export function mockStageDb(): StageDb {
  return {
    // One move at a time, like the row lock.
    run<T>(fn: (t: StageTx) => Promise<T>): Promise<T> {
      const next = chain.then(() => fn(tx));
      chain = next.catch(() => undefined);
      return next;
    },
    async bookingContact(_workspaceId, bookingId) {
      return mockBookingRows().get(bookingId)?.contactId ?? null;
    },
  };
}
