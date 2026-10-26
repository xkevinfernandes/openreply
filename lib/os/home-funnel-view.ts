// Client-safe half of Home's funnel and the All · funnel board (dm-crm
// 031/032): types, the switch's constants and pure display helpers. No
// server imports here (client components use it); lib/os/home-funnel.ts has
// the loaders. The window constants mirror lib/os/crm-funnel.ts (a test
// pins them; crm-funnel also holds the server loader). Money: lib/os/money.ts.

import type { FunnelBoardColumn, FunnelView, FunnelWindow } from "@/lib/os/crm-funnel";

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const WINDOWS: readonly FunnelWindow[] = [7, 30, 90];
export const DEFAULT_WINDOW: FunnelWindow = 30;
/** localStorage key for the 7/30/90 switch (crm-funnel FUNNEL_WINDOW_KEY). */
export const WINDOW_KEY = "os_funnel_window";

export function parseWindow(v: unknown): FunnelWindow {
  const n = Number(v);
  return (WINDOWS as readonly number[]).includes(n) ? (n as FunnelWindow) : DEFAULT_WINDOW;
}

/** Home's subtitle and the All board's tooltip (crm-funnel cohortLabel). */
export function windowLabel(window: FunnelWindow): string {
  return `People who first DMed or commented in the last ${window} days`;
}

export function windowFrom(window: FunnelWindow, now: Date): Date {
  return new Date(now.getTime() - window * DAY);
}

export interface InboxCounts {
  unread: number;
  draftsWaiting: number;
  windowClosing: number;
}

export type FunnelViews = Record<FunnelWindow, FunnelView>;


export interface FlowDot {
  /** Vertical position, % of the shape's height. */
  top: number;
  /** Where the dot drops out, % of the shape's width. */
  end: number;
  dur: number;
  delay: number;
}

/**
 * Pure: the people flowing through the funnel shape, left to right, dropping
 * out at each step in proportion to who left there (about 28 dots in all).
 */
export function flowDots(counts: number[], heightOf: (n: number) => number): FlowDot[] {
  const first = counts[0] ?? 0;
  if (!first) return [];
  const per = Math.max(1, first / 28);
  const dots: FlowDot[] = [];
  let n = 0;
  counts.forEach((count, i) => {
    const last = i === counts.length - 1;
    const next = last ? 0 : counts[i + 1];
    const leaving = Math.min(12, Math.round((count - next) / per));
    const end = last ? 100 : ((i + 1) / counts.length) * 100;
    const half = (Math.min(heightOf(count), last ? heightOf(count) : heightOf(next)) / 2) * 0.7;
    for (let k = 0; k < leaving; k++) {
      dots.push({
        top: 50 + (((n * 37) % 100) / 100 - 0.5) * 2 * half,
        end,
        dur: 2.2 + end / 30,
        delay: (n * 0.53) % 6,
      });
      n++;
    }
  });
  return dots;
}

/** Pure: "2h", "3d", "5w". */
export function shortAge(from: Date, now: Date): string {
  const ms = Math.max(0, now.getTime() - from.getTime());
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / 60_000))}m`;
  if (ms < DAY - HOUR / 2) return `${Math.round(ms / HOUR)}h`;
  if (ms < 14 * DAY) return `${Math.round(ms / DAY)}d`;
  return `${Math.round(ms / (7 * DAY))}w`;
}

export interface BoardCard {
  id: string;
  name: string;
  setter: string;
  age: string;
  archived: boolean;
  wonAmount: number | null;
}

export interface BoardColumnView {
  key: FunnelBoardColumn;
  label: string;
  reached: number | null;
  pctReached: number | null;
  /** Every cohort contact here, archived included (the board hides those unless asked). */
  contactIds: string[];
}

export interface AllBoardData {
  windows: Record<FunnelWindow, BoardColumnView[]>;
  cards: Record<string, BoardCard>;
}

/** Pure: the board columns a card may be dropped on (the rest come from the conversation and the booking). */
export function canDropOn(target: FunnelBoardColumn, from: FunnelBoardColumn): boolean {
  return (target === "won" || target === "lost") && target !== from;
}

export interface NoAmountWin {
  id: string;
  name: string;
  /** Default for the picker's date: the won event's time. */
  wonAt: string;
}

export interface HomeFunnelData {
  views: FunnelViews;
  currency: string;
  /** Stage history starts here (the Qualified note). */
  stageLogSince: string;
  noAmount: NoAmountWin[];
}
