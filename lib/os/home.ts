// Home: the pure helpers and loaders behind app/(os)/os/page.tsx (Main board).

import { prisma } from "@/lib/db/client";
import { columnFor, countByColumn, funnelColumns, type StageInput } from "@/lib/os/funnel";
import { mockThreads, osMockEnabled } from "@/lib/os/mock";
import { localDate } from "@/lib/os/sending/cap";
import { asFunnel } from "@/lib/os/setter/kb";
import { pendingDrafts } from "@/lib/os/setter/service";
import { windowState, type StateConfig } from "@/lib/os/setter/state";

// --- Setter funnel (V1-1) ------------------------------------------------------

/** J's six setting stages, in order. */
export const J_STAGES = [
  { key: "opener", label: "Opener" },
  { key: "value", label: "Value" },
  { key: "permission", label: "Permission" },
  { key: "qualify", label: "Qualify" },
  { key: "bridge", label: "Bridge" },
  { key: "booked", label: "Booked" },
] as const;

export interface Bar {
  key: string;
  label: string;
  count: number;
}

export interface AwaitingRow {
  theirLastAt: string | null;
  ourLastAt: string | null;
}

/** Pure: how many "you owe a reply" threads still have the free window, and the soonest close. */
export function closingWindows(rows: AwaitingRow[], now: Date, cfg?: StateConfig): { count: number; nextClose: string | null } {
  let count = 0;
  let next: string | null = null;
  for (const r of rows) {
    if (!r.theirLastAt || (r.ourLastAt && r.ourLastAt >= r.theirLastAt)) continue;
    const [win, until] = windowState(r.theirLastAt, now, cfg);
    if (win !== "free") continue;
    count++;
    if (until && (!next || until < next)) next = until;
  }
  return { count, nextClose: next };
}

/** Pure: counts in a fixed key order (unknown keys dropped). */
export function countBars(keys: readonly { key: string; label: string }[], values: (string | null)[]): Bar[] {
  const n = new Map<string, number>();
  for (const v of values) if (v) n.set(v, (n.get(v) ?? 0) + 1);
  return keys.map((k) => ({ key: k.key, label: k.label, count: n.get(k.key) ?? 0 }));
}

// --- Home (Main board) ---------------------------------------------------------
// Greeting, the pipeline per setter (funnel.ts columns), Setters cards and the
// "Add link for Follow-up Friday" to-do. The outcome row is lib/os/metrics.ts.

/** Pure: "Good morning" / "Good afternoon" / "Good evening" in the workspace timezone. */
export function greeting(now: Date, timezone: string): string {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(now));
  return h < 5 ? "Good evening" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Pure: "Monday 19 October". */
export function homeDate(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, weekday: "long", day: "numeric", month: "long" }).format(now).replace(",", "");
}

export interface SetterLite {
  id: string;
  name: string;
  isDefault: boolean;
  autonomy: "APPROVE" | "AUTO";
  funnel: unknown;
}

/** Pure: the default setter first, then by creation (rows arrive oldest first). */
export function orderSetters<T extends { isDefault: boolean }>(setters: T[]): T[] {
  return [...setters.filter((s) => s.isDefault), ...setters.filter((s) => !s.isDefault)];
}

export interface PipelineContact {
  setterId: string | null;
  stage: StageInput["stage"];
  setterStage: string | null;
  attendance: StageInput["attendance"];
}

/** Pure: whose pipeline a contact sits in (no setter = the default one). */
export function belongsTo(c: Pick<PipelineContact, "setterId">, setterId: string, defaultId: string | null): boolean {
  return c.setterId ? c.setterId === setterId : setterId === defaultId;
}

export interface PipelineView {
  setters: { id: string; name: string }[];
  selected: string | null;
  rows: { key: string; label: string; count: number }[];
}

export interface SetterCard {
  id: string;
  name: string;
  /** Sales contacts still in this setter's funnel (not booked/won/lost). */
  open: number;
  drafts: number;
  mode: string;
}

/** Pure: pipeline rows and setter cards from contacts and setters. */
export function buildPipeline(
  setters: SetterLite[],
  contacts: PipelineContact[],
  drafts: { setterId?: string | null; contactId: string }[],
  selected: string | null
): { pipeline: PipelineView; cards: SetterCard[] } {
  const ordered = orderSetters(setters);
  const defaultId = ordered[0]?.id ?? null;
  const pick = ordered.find((s) => s.id === selected) ?? ordered[0] ?? null;
  const columnsOf = (s: SetterLite | null) => funnelColumns(s ? asFunnel(s.funnel) : null);
  const mine = (s: SetterLite) => contacts.filter((c) => belongsTo(c, s.id, defaultId));
  const rows = countByColumn(pick ? mine(pick) : contacts, columnsOf(pick));
  const cards = ordered.map((s) => {
    const cols = columnsOf(s);
    const funnelKeys = new Set(cols.filter((c) => c.group === "funnel").map((c) => c.key));
    return {
      id: s.id,
      name: s.name,
      open: mine(s).filter((c) => funnelKeys.has(columnFor(c, cols))).length,
      drafts: drafts.filter((d) => (d.setterId ? d.setterId === s.id : s.id === defaultId)).length,
      mode: s.autonomy === "AUTO" ? "Autopilot" : "Approve-only",
    };
  });
  return { pipeline: { setters: ordered.map((s) => ({ id: s.id, name: s.name })), selected: pick?.id ?? null, rows }, cards };
}

export async function loadPipeline(workspaceId: string, selected: string | null) {
  const [setters, drafts] = await Promise.all([
    prisma.setter.findMany({
      where: { workspaceId },
      select: { id: true, name: true, isDefault: true, autonomy: true, funnel: true },
      orderBy: { createdAt: "asc" },
    }),
    pendingDrafts(workspaceId).catch(() => []),
  ]);
  let contacts: PipelineContact[];
  if (osMockEnabled()) {
    contacts = mockThreads()
      .filter((t) => t.contact?.kind === "SALES")
      .map((t) => ({ setterId: null, stage: t.contact!.stage, setterStage: t.contact!.setterStage ?? null, attendance: null }));
  } else {
    const rows = await prisma.contact.findMany({
      where: { workspaceId, kind: "SALES" },
      select: { setterId: true, stage: true, setterStage: true, bookings: { select: { attendance: true }, orderBy: { start: "desc" }, take: 1 } },
      take: 5000,
    });
    contacts = rows.map((r) => ({ setterId: r.setterId, stage: r.stage, setterStage: r.setterStage, attendance: r.bookings[0]?.attendance ?? null }));
  }
  return { ...buildPipeline(setters, contacts, drafts, selected), draftsWaiting: drafts.length };
}

// --- Follow-up Friday link ------------------------------------------------------

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Pure: the next run date ("YYYY-MM-DD", workspace tz) of a weekly window; today counts until it ends. */
export function nextRunDate(windowDay: number, windowEnd: string, timezone: string, now: Date): { date: string; today: boolean } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  const dow = DOW.indexOf(parts.weekday);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const [eh, em] = windowEnd.split(":").map(Number);
  let ahead = (windowDay - dow + 7) % 7;
  if (ahead === 0 && minutes >= eh * 60 + (em || 0)) ahead = 7;
  const local = localDate(new Date(now.getTime() + ahead * 86400_000), timezone);
  return { date: local, today: ahead === 0 };
}

export interface HomeTodo {
  id: string;
  label: string;
  strong: string;
  due: string;
  tone: "warn" | "muted";
  href: string;
}

/** Broadcasts that need Kevin: a link for the next run, or drafts to review. */
export async function broadcastTodos(workspaceId: string, now = new Date()): Promise<HomeTodo[]> {
  // One source with Follow-ups: lib/os/broadcasts/engine.ts broadcastNeeds.
  const { broadcastNeeds } = await import("@/lib/os/broadcasts/engine");
  const needs = await broadcastNeeds(workspaceId, { now });
  return needs.map((n) => ({
    id: `broadcast:${n.key}:${n.kind}`,
    label: n.kind === "link" ? "Add link for" : `Review ${n.count} ${n.count === 1 ? "draft" : "drafts"} for`,
    strong: n.name,
    due: n.today ? "Today" : n.day,
    tone: n.today ? "warn" : "muted",
    href: n.href,
  }));
}
