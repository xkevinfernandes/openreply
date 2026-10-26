// The Pipeline board (dm-crm issue 019), pure: one setter's board (its
// stages, then Booked, Showed, No-show, Won, Lost), the cards on it, the
// counts, and where each card may go, read from the move table
// (lib/os/move-table.ts) so the board, the panel and the writer agree.
// Client-safe.

import type { ContactRow, SetterOption } from "@/lib/os/contacts-board";
import { columnFor, funnelColumns, type FunnelColumn } from "@/lib/os/funnel";
import { BOOKING_COLUMNS, moveTargets, type MoveTarget, type StageState } from "@/lib/os/move-table";

export const ALL_BOARD = "all";

/** The setter a board shows: ?setter=, else the default, else the first. "all" is the All · funnel board. */
export function pickSetter(setters: SetterOption[], wanted: string | null | undefined): string {
  if (wanted === ALL_BOARD) return ALL_BOARD;
  if (wanted && setters.some((s) => s.id === wanted)) return wanted;
  return (setters.find((s) => s.isDefault) ?? setters[0])?.id ?? "";
}

export function boardColumnsFor(setters: SetterOption[], setterId: string): FunnelColumn[] {
  const s = setters.find((x) => x.id === setterId) ?? setters.find((x) => x.isDefault) ?? null;
  return funnelColumns(s?.funnel ?? null);
}

/** Does this card belong on this setter's board? No setter = the default's. */
export function onBoard(c: Pick<ContactRow, "setterId">, setterId: string, defaultId: string | null): boolean {
  return (c.setterId ?? defaultId) === setterId;
}

/** A card's state for the move table. */
export function stateOf(c: ContactRow, columns: FunnelColumn[]): StageState {
  return {
    stage: c.stage,
    setterStage: c.setterStage,
    setterId: c.setterId,
    attendance: c.attendance ?? null,
    liveBooking: Boolean(c.booking && c.booking.status !== "CANCELLED"),
    columns,
  };
}

export function columnOfCard(c: ContactRow, columns: FunnelColumn[]): string {
  return columnFor({ stage: c.stage, setterStage: c.setterStage, attendance: c.attendance ?? null }, columns);
}

/** The columns this card may be dropped on. */
export function cardTargets(c: ContactRow, columns: FunnelColumn[]): MoveTarget[] {
  return moveTargets(stateOf(c, columns));
}

export function allowedKeys(c: ContactRow, columns: FunnelColumn[]): Set<string> {
  return new Set(cardTargets(c, columns).filter((t) => t.allowed).map((t) => t.key));
}

/** "Move selected…": one card gets its own targets; several go to Won or Lost only. */
export function selectionTargets(cards: ContactRow[], columns: FunnelColumn[]): MoveTarget[] {
  if (cards.length === 1) return cardTargets(cards[0], columns);
  return ["won", "lost"].map((key) => {
    const label = columns.find((c) => c.key === key)?.label ?? key;
    const ok = cards.some((c) => allowedKeys(c, columns).has(key));
    return ok ? { key, label, allowed: true } : { key, label, allowed: false, reason: "None of them can go there." };
  });
}

export const SEVERAL_WON_LOST = "Several cards go to Won or Lost only.";

/**
 * What a drag carries. Grabbing a ticked card while others are ticked drags
 * them all, and they go to Won or Lost only (like "Move selected…"); any
 * other card drags alone. Every column gets allowed or a reason, so a drop
 * on a closed column can say why.
 */
export function dragPlan(grabbed: ContactRow, picked: ContactRow[], columns: FunnelColumn[]): { ids: string[]; targets: MoveTarget[] } {
  const group = picked.length > 1 && picked.some((c) => c.id === grabbed.id);
  if (!group) return { ids: [grabbed.id], targets: cardTargets(grabbed, columns) };
  const endTargets = new Map(selectionTargets(picked, columns).map((t) => [t.key, t]));
  const here = columnOfCard(grabbed, columns);
  return {
    ids: picked.map((c) => c.id),
    targets: columns.map(
      (c) =>
        endTargets.get(c.key) ??
        (c.key === here ? { key: c.key, label: c.label, allowed: false, reason: "Here now" } : { key: c.key, label: c.label, allowed: false, reason: SEVERAL_WON_LOST })
    ),
  };
}

export function isBookingColumn(key: string): boolean {
  return BOOKING_COLUMNS.includes(key);
}

export interface BoardLane {
  column: FunnelColumn;
  cards: ContactRow[];
  /** Won: the sum of the amounts on the column. */
  total: number | null;
  /** Won cards with no amount yet. */
  noAmount: number;
}

/** Cards per column in board order, newest activity first. */
export function boardLanes(rows: ContactRow[], columns: FunnelColumn[]): BoardLane[] {
  const by = new Map(columns.map((c) => [c.key, [] as ContactRow[]]));
  for (const r of rows) (by.get(columnOfCard(r, columns)) ?? by.get(columns[0]?.key ?? ""))?.push(r);
  const when = (r: ContactRow) => Date.parse(r.lastActivityAt ?? r.lastMessageAt ?? "") || 0;
  return columns.map((column) => {
    const cards = (by.get(column.key) ?? []).sort((a, b) => when(b) - when(a));
    const won = column.key === "won";
    return {
      column,
      cards,
      total: won ? cards.reduce((s, c) => s + (c.won?.amount ?? 0), 0) : null,
      noAmount: won ? cards.filter((c) => !c.won).length : 0,
    };
  });
}

/** The change the board shows before the server answers. */
export function moveLocally(c: ContactRow, to: string, columns: FunnelColumn[]): ContactRow {
  if (to === "won") return { ...c, stage: "WON" };
  if (to === "lost") return { ...c, stage: "LOST", won: null };
  const col = columns.find((x) => x.key === to);
  if (col?.group !== "funnel") return c;
  const outcome = ["CALL_BOOKED", "SHOWED", "WON", "LOST", "NOT_QUALIFIED"].includes(c.stage);
  return { ...c, setterStage: to, stage: outcome ? "IN_CONVERSATION" : c.stage, won: null };
}

export type BoardLinkParams = { view?: string; c?: string; contact?: string; tab?: string; stage?: string; setter?: string };

/** A board link from before the split: the same board on Pipeline. */
export function boardRedirect(params: BoardLinkParams): string | null {
  const board = params.view === "kanban" || params.view === "board" || Boolean(params.stage) || Boolean(params.setter);
  if (!board) return null;
  const q = new URLSearchParams();
  if (params.setter) q.set("setter", params.setter);
  if (params.stage) q.set("stage", params.stage);
  const c = params.c ?? params.contact;
  if (c) q.set("c", c);
  if (params.tab) q.set("tab", params.tab);
  const s = q.toString();
  return `/os/pipeline${s ? `?${s}` : ""}`;
}
