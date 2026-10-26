// The move table (dm-crm, factory/dm-crm/prd.md "What each move writes"),
// pure: what a stage change does to a contact in a given state, for a given
// cause, and where Kevin may move a contact now. The stage writer
// (lib/os/stage-writer.ts) applies it in a locked transaction; the Pipeline
// board and the contact panel read moveTargets in the browser. No database.

import type { ContactStage } from "@/app/generated/prisma/enums";
import { columnFor, type FunnelColumn } from "@/lib/os/funnel";

export const STAGE_CAUSES = ["setter", "user", "booking", "sequence", "automation", "import", "migration"] as const;
export type StageCause = (typeof STAGE_CAUSES)[number];

export type Attendance = "SHOWED" | "NO_SHOW";

/** Columns that come from the booking and its attendance, never from a move. */
export const BOOKING_COLUMNS: readonly string[] = ["booked", "showed", "no_show"];

export type StageChange =
  /** A move to a board column: a setter stage key, or booked | showed | no_show | won | lost. */
  | { type: "column"; column: string }
  /** A stage value as today's writers set it (booking confirm, calendar, imports…), with an optional hint. */
  | { type: "stage"; stage: ContactStage; setterStage?: string | null }
  /** J's stage hint. */
  | { type: "setterStage"; setterStage: string | null }
  /** A call's attendance (and, on a reschedule, its reset to null). */
  | { type: "attendance"; bookingId: string; attendance: Attendance | null; source?: string | null; at?: Date }
  /** Undo Won: back to Booked if a live booking exists, else in conversation. */
  | { type: "undoWon" };

export interface StageState {
  stage: ContactStage;
  setterStage: string | null;
  setterId: string | null;
  /** The latest call attendance (null = none). */
  attendance: Attendance | null;
  /** A booking that isn't cancelled. */
  liveBooking: boolean;
  /** The contact's setter's board columns. */
  columns: FunnelColumn[];
}

export type StageDecision =
  | { kind: "unchanged"; from: string; to: string }
  | { kind: "refuse"; from: string; to: string; reason: string }
  | { kind: "apply"; from: string; to: string; data: { stage?: ContactStage; setterStage?: string | null }; clearWon: boolean };

const AUTOMATIC = new Set<StageCause>(["setter", "booking", "sequence", "automation", "import", "migration"]);
/** Causes that move by the move table (booking and setter write as they always did). */
const BY_TABLE = new Set<StageCause>(["user", "sequence", "automation", "import", "migration"]);

const OFF_WON = "Only Kevin takes someone off Won.";
const FROM_BOOKING = "Set from the booking.";
const CHANGE_BOOKING = "Change the booking instead.";
const HAS_ATTENDANCE = "They have a call on record: change the booking instead.";

export function columnOf(s: Pick<StageState, "stage" | "setterStage" | "attendance" | "columns">): string {
  return columnFor({ stage: s.stage, setterStage: s.setterStage, attendance: s.attendance }, s.columns);
}

/**
 * The move table, pure. What a change does to a contact in this state, for
 * this cause: apply (and what to write), refuse (and why) or nothing to do.
 * Attendance is decided by applyChange (it writes the booking, not the contact).
 */
export function decideMove(state: StageState, change: Exclude<StageChange, { type: "attendance" }>, cause: StageCause): StageDecision {
  const from = columnOf(state);
  const after = (data: { stage?: ContactStage; setterStage?: string | null }) => columnOf({ ...state, ...data });
  const leavingWon = (to: string) => from === "won" && to !== "won";

  if (change.type === "undoWon") {
    if (cause !== "user") return { kind: "refuse", from, to: from, reason: OFF_WON };
    if (from !== "won") return { kind: "refuse", from, to: from, reason: "They aren't on Won." };
    const data = { stage: (state.liveBooking ? "CALL_BOOKED" : "IN_CONVERSATION") as ContactStage };
    return { kind: "apply", from, to: after(data), data, clearWon: true };
  }

  if (change.type === "setterStage") {
    const data = { setterStage: change.setterStage };
    const to = after(data);
    if (leavingWon(to) && cause !== "user") return { kind: "refuse", from, to, reason: OFF_WON };
    if (data.setterStage === state.setterStage) return { kind: "unchanged", from, to };
    return { kind: "apply", from, to, data, clearWon: leavingWon(to) };
  }

  if (change.type === "stage") {
    const data: { stage: ContactStage; setterStage?: string | null } = { stage: change.stage, ...(change.setterStage !== undefined ? { setterStage: change.setterStage } : {}) };
    const to = after(data);
    if (leavingWon(to) && cause !== "user") return { kind: "refuse", from, to, reason: OFF_WON };
    if (BY_TABLE.has(cause) && to !== from && BOOKING_COLUMNS.includes(to)) return { kind: "refuse", from, to, reason: FROM_BOOKING };
    if (data.stage === state.stage && (data.setterStage === undefined || data.setterStage === state.setterStage)) return { kind: "unchanged", from, to };
    return { kind: "apply", from, to, data, clearWon: leavingWon(to) };
  }

  // A move to a column (user, sequence, automation, import; booking/setter never move by column).
  const to = change.column;
  const col = state.columns.find((c) => c.key === to);
  if (!col) return { kind: "refuse", from, to, reason: "Unknown column." };
  if (to === from) return { kind: "unchanged", from, to };
  if (BOOKING_COLUMNS.includes(to)) return { kind: "refuse", from, to, reason: FROM_BOOKING };
  if (leavingWon(to) && AUTOMATIC.has(cause)) return { kind: "refuse", from, to, reason: OFF_WON };

  let data: { stage?: ContactStage; setterStage?: string | null };
  if (col.group === "funnel") {
    if (BOOKING_COLUMNS.includes(from)) {
      if (state.liveBooking) return { kind: "refuse", from, to, reason: CHANGE_BOOKING };
      data = { stage: "IN_CONVERSATION", setterStage: to };
    } else if (from === "won" || from === "lost") {
      if (state.attendance) return { kind: "refuse", from, to, reason: HAS_ATTENDANCE };
      data = { stage: "IN_CONVERSATION", setterStage: to };
    } else {
      data = { setterStage: to };
    }
  } else if (to === "won") {
    data = { stage: "WON" };
  } else if (to === "lost") {
    data = { stage: "LOST" };
  } else {
    return { kind: "refuse", from, to, reason: "Unknown column." };
  }
  // Attendance outranks the hint: never write a move that lands elsewhere.
  if (after(data) !== to) return { kind: "refuse", from, to, reason: state.attendance ? HAS_ATTENDANCE : CHANGE_BOOKING };
  return { kind: "apply", from, to, data, clearWon: leavingWon(to) };
}

/** Where Kevin can move a contact now (board drop targets, the panel's dropdown). */
export interface MoveTarget {
  key: string;
  label: string;
  allowed: boolean;
  reason?: string;
}

export function moveTargets(state: StageState): MoveTarget[] {
  return state.columns.map((c) => {
    if (c.key === columnOf(state)) return { key: c.key, label: c.label, allowed: false, reason: "Here now" };
    const d = decideMove(state, { type: "column", column: c.key }, "user");
    return d.kind === "apply" ? { key: c.key, label: c.label, allowed: true } : { key: c.key, label: c.label, allowed: false, reason: d.kind === "refuse" ? d.reason : undefined };
  });
}
