// The one stage writer (dm-crm slice 1, issues 002/003). It alone writes the
// contact stage (Contact.stage), J's stage hint (Contact.setterStage) and
// booking attendance (Booking.attendance). Every writer passes its cause:
//
//   setter     J's stage hints and outcome judgments
//   user       Kevin: board drag, panel stage, bulk move, Undo Won
//   booking    the booking store, the calendar sync and events, attendance
//   sequence   the follow-up sequence engine
//   automation workflows
//   import     the one-time imports
//   migration  data migrations
//
// One transaction per move: lock the contact row (SELECT … FOR UPDATE), read
// its board column (lib/os/funnel.ts columnFor), decide by the move table
// (factory/dm-crm/prd.md "What each move writes"), write, and log one row in
// ContactStageLog per column change and one per refused move (a repeat of the
// newest refusal since the last applied move isn't logged again).
//
// Booking and setter causes write exactly what they wrote before this
// existed and apply from any column, except that no automatic cause takes a
// contact off Won. Only Kevin does (a user move or Undo Won). Leaving Won
// clears the won amount and offer (lib/os/events.ts clearWonData).
//
// __tests__/os/stage-writer-scan.test.ts fails if any other module writes one
// of the three fields.

import type { ContactStage } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { clearWonData, type WonDb } from "@/lib/os/events";
import { funnelColumns, type FunnelStageLike } from "@/lib/os/funnel";

export {
  STAGE_CAUSES,
  BOOKING_COLUMNS,
  columnOf,
  decideMove,
  moveTargets,
  type StageCause,
  type Attendance,
  type StageChange,
  type StageState,
  type StageDecision,
  type MoveTarget,
} from "@/lib/os/move-table";
import { STAGE_CAUSES, columnOf, decideMove, type Attendance, type StageCause, type StageChange, type StageState } from "@/lib/os/move-table";

// --- Storage port ---------------------------------------------------------------

export interface StageLogRow {
  workspaceId: string;
  contactId: string;
  setterId: string | null;
  fromColumn: string | null;
  toColumn: string;
  outcome: "applied" | "refused";
  cause: StageCause;
  reason: string | null;
  at: Date;
}

export interface StageTx {
  /** Locks the contact row for the rest of the transaction. */
  lock(workspaceId: string, contactId: string): Promise<StageState | null>;
  update(workspaceId: string, contactId: string, data: { stage?: ContactStage; setterStage?: string | null }): Promise<void>;
  /** Writes a booking's attendance; the booking's contact when it belongs to this workspace. */
  setAttendance(workspaceId: string, bookingId: string, data: { attendance: Attendance | null; source: string | null; at: Date | null }): Promise<string | null>;
  clearWon(contactId: string): Promise<void>;
  /** Refused rows since the contact's last applied row. */
  refusedSinceApplied(contactId: string): Promise<{ cause: string; toColumn: string }[]>;
  log(row: StageLogRow): Promise<void>;
}

export interface StageDb {
  run<T>(fn: (tx: StageTx) => Promise<T>): Promise<T>;
  /** The contact a booking belongs to (attendance writes name the booking). */
  bookingContact(workspaceId: string, bookingId: string): Promise<string | null>;
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export function funnelOfJson(json: unknown): FunnelStageLike[] {
  return Array.isArray(json)
    ? json
        .filter((s): s is { key?: unknown; label?: unknown } => Boolean(s) && typeof s === "object")
        .filter((s) => typeof s.key === "string" || typeof s.label === "string")
        .map((s) => ({ key: String(s.key ?? s.label), label: String(s.label ?? s.key) }))
    : [];
}

/** A contact's setter (its own, else the account's default, else the workspace's) and its funnel. */
async function setterFunnel(tx: Tx, workspaceId: string, setterId: string | null, instagramAccountId: string): Promise<{ id: string | null; funnel: FunnelStageLike[] }> {
  const select = { id: true, funnel: true } as const;
  const s =
    (setterId ? await tx.setter.findFirst({ where: { id: setterId, workspaceId }, select }) : null) ??
    (await tx.setter.findFirst({ where: { workspaceId, instagramAccountId, isDefault: true }, select })) ??
    (await tx.setter.findFirst({ where: { workspaceId, isDefault: true }, orderBy: { createdAt: "asc" }, select })) ??
    (await tx.setter.findFirst({ where: { workspaceId }, orderBy: { createdAt: "asc" }, select }));
  return { id: s?.id ?? null, funnel: funnelOfJson(s?.funnel) };
}

function prismaTx(tx: Tx): StageTx {
  return {
    async lock(workspaceId, contactId) {
      const rows = await tx.$queryRaw<{ stage: ContactStage; setterStage: string | null; setterId: string | null; instagramAccountId: string }[]>`
        SELECT "stage"::text AS "stage", "setterStage", "setterId", "instagramAccountId"
        FROM "Contact" WHERE "id" = ${contactId} AND "workspaceId" = ${workspaceId} FOR UPDATE`;
      const c = rows[0];
      if (!c) return null;
      const [att, live, setter] = await Promise.all([
        tx.booking.findFirst({ where: { contactId, attendance: { not: null } }, orderBy: { createdAt: "desc" }, select: { attendance: true } }),
        tx.booking.count({ where: { contactId, status: { not: "CANCELLED" } } }),
        setterFunnel(tx, workspaceId, c.setterId, c.instagramAccountId),
      ]);
      return {
        stage: c.stage,
        setterStage: c.setterStage,
        setterId: c.setterId ?? setter.id,
        attendance: att?.attendance ?? null,
        liveBooking: live > 0,
        columns: funnelColumns(setter.funnel),
      };
    },
    async update(workspaceId, contactId, data) {
      await tx.contact.updateMany({ where: { id: contactId, workspaceId }, data });
    },
    async setAttendance(workspaceId, bookingId, data) {
      const b = await tx.booking.findFirst({ where: { id: bookingId, workspaceId }, select: { contactId: true } });
      if (!b) return null;
      await tx.booking.updateMany({
        where: { id: bookingId, workspaceId },
        data: { attendance: data.attendance, attendanceSource: data.attendance ? data.source : null, attendanceAt: data.attendance ? data.at : null },
      });
      return b.contactId;
    },
    async clearWon(contactId) {
      await clearWonData(contactId, tx as unknown as WonDb);
    },
    async refusedSinceApplied(contactId) {
      const last = await tx.contactStageLog.findFirst({ where: { contactId, outcome: "applied" }, orderBy: { at: "desc" }, select: { at: true } });
      return tx.contactStageLog.findMany({
        where: { contactId, outcome: "refused", ...(last ? { at: { gte: last.at } } : {}) },
        select: { cause: true, toColumn: true },
      });
    },
    async log(row) {
      await tx.contactStageLog.create({ data: row });
    },
  };
}

export const prismaStageDb: StageDb = {
  run: (fn) => prisma.$transaction((tx) => fn(prismaTx(tx)), { timeout: 15_000 }),
  async bookingContact(workspaceId, bookingId) {
    return (await prisma.booking.findFirst({ where: { id: bookingId, workspaceId }, select: { contactId: true } }))?.contactId ?? null;
  },
};

async function defaultDb(): Promise<StageDb> {
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) return (await import("@/lib/os/stage-writer-mock")).mockStageDb();
  return prismaStageDb;
}

// --- The writer ---------------------------------------------------------------

export interface StageWriteInput {
  workspaceId: string;
  contactId: string;
  cause: StageCause;
  change: StageChange;
  at?: Date;
}

export type StageWriteResult =
  | { status: "applied"; from: string; to: string; stage: ContactStage; logged: boolean }
  | { status: "unchanged"; from: string; to: string }
  | { status: "refused"; from: string; to: string; reason: string }
  | { status: "missing"; reason: string };

export interface StageWriterDeps {
  db?: StageDb;
  /** The existing stage-changed hook (OsEvent won); called after a stage change. */
  onStageChanged?: ((info: { workspaceId: string; contactId: string; stage: ContactStage; at?: Date }) => Promise<void>) | null;
}

async function defaultHook(info: { workspaceId: string; contactId: string; stage: ContactStage; at?: Date }) {
  const { osEventHooks } = await import("@/lib/os/events-hooks");
  await osEventHooks.onStageChanged(info);
}

/** Write a stage change through the move table, in one locked transaction. */
export async function writeStage(input: StageWriteInput, deps: StageWriterDeps = {}): Promise<StageWriteResult> {
  if (!(STAGE_CAUSES as readonly string[]).includes(input.cause)) throw new Error("A stage write needs a cause.");
  const db = deps.db ?? (await defaultDb());
  const at = input.at ?? new Date();
  const { change, workspaceId, cause } = input;

  let contactId = input.contactId;
  if (change.type === "attendance" && !contactId) contactId = (await db.bookingContact(workspaceId, change.bookingId)) ?? "";
  if (!contactId) return { status: "missing", reason: "That contact is gone." };

  const result = await db.run(async (tx): Promise<StageWriteResult & { stageChanged?: boolean }> => {
    const s0 = await tx.lock(workspaceId, contactId);
    if (!s0) return { status: "missing", reason: "That contact is gone." };
    const from = columnOf(s0);
    const log = (outcome: "applied" | "refused", to: string, reason: string | null) =>
      tx.log({ workspaceId, contactId, setterId: s0.setterId, fromColumn: from, toColumn: to, outcome, cause, reason, at });
    const refuse = async (to: string, reason: string): Promise<StageWriteResult> => {
      const repeats = await tx.refusedSinceApplied(contactId);
      if (!repeats.some((r) => r.cause === cause && r.toColumn === to)) await log("refused", to, reason);
      return { status: "refused", from, to, reason };
    };

    if (change.type === "attendance") {
      // The booking row always updates (also on Won: the stage stays, the call is recorded).
      const owner = await tx.setAttendance(workspaceId, change.bookingId, { attendance: change.attendance, source: change.source ?? null, at: change.attendance ? (change.at ?? at) : null });
      if (!owner) return { status: "missing", reason: "That booking is gone." };
      const s1 = await tx.lock(workspaceId, contactId);
      const to = s1 ? columnOf(s1) : from;
      if (to === from) return { status: "unchanged", from, to };
      await log("applied", to, null);
      return { status: "applied", from, to, stage: s1!.stage, logged: true };
    }

    const d = decideMove(s0, change, cause);
    if (d.kind === "unchanged") return { status: "unchanged", from, to: d.to };
    if (d.kind === "refuse") return refuse(d.to, d.reason);
    await tx.update(workspaceId, contactId, d.data);
    if (d.clearWon) await tx.clearWon(contactId);
    const logged = d.to !== from;
    if (logged) await log("applied", d.to, null);
    const stage = d.data.stage ?? s0.stage;
    return { status: "applied", from, to: d.to, stage, logged, stageChanged: stage !== s0.stage };
  });

  if (result.status === "applied" && "stageChanged" in result && result.stageChanged) {
    const hook = deps.onStageChanged === undefined ? defaultHook : deps.onStageChanged;
    if (hook) await hook({ workspaceId, contactId, stage: result.stage, at }).catch((err) => console.error("[OS Stage] hook:", err instanceof Error ? err.message : err));
  }
  if ("stageChanged" in result) delete (result as { stageChanged?: boolean }).stageChanged;
  return result;
}

/** Attendance for a booking (the calendar's webhook, Kevin marking it, a reschedule's reset). */
export function writeAttendance(input: { workspaceId: string; bookingId: string; attendance: Attendance | null; source?: string | null; at?: Date; cause?: StageCause }, deps: StageWriterDeps = {}) {
  return writeStage(
    { workspaceId: input.workspaceId, contactId: "", cause: input.cause ?? "booking", change: { type: "attendance", bookingId: input.bookingId, attendance: input.attendance, source: input.source ?? null, at: input.at }, at: input.at },
    deps
  );
}

/** The stage log for a contact, newest first (the contact panel's history). */
export async function stageHistory(workspaceId: string, contactId: string, take = 50) {
  const { osMockEnabled } = await import("@/lib/os/mock");
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockStageLog(contactId).slice(0, take);
  return prisma.contactStageLog.findMany({ where: { workspaceId, contactId }, orderBy: { at: "desc" }, take });
}
