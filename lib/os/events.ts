// The outcome log behind Home (OsEvent). Every recorder passes a dedupeKey, so
// hooks, retries and the backfill can all run twice without counting twice.
// Recording never throws into the caller: a lost event is better than a send
// that looks failed.

import { prisma } from "@/lib/db/client";

export const OS_EVENT_KINDS = [
  /** A keyword fired an automation (comment, DM keyword, story). Backfilled from DmLog. */
  "keyword_trigger",
  "conversation_started",
  "lead_magnet_sent",
  "offer_made",
  "call_booked",
  "showed",
  "won",
  "dm_sent",
] as const;

export type OsEventKind = (typeof OS_EVENT_KINDS)[number];

export interface OsEventInput {
  workspaceId: string;
  kind: OsEventKind;
  /** Stable id of the fact, e.g. "call_booked:<bookingId>". Use eventKey(). */
  dedupeKey: string;
  contactId?: string | null;
  setterId?: string | null;
  at?: Date;
  data?: Record<string, unknown>;
}

/** The slice of Prisma the event log uses (tests pass a fake). */
export interface EventsDb {
  osEvent: {
    createMany(args: { data: object[]; skipDuplicates?: boolean }): Promise<{ count: number }>;
    count(args: { where: object }): Promise<number>;
    groupBy?: unknown;
  };
}

const defaultDb = () => prisma as unknown as EventsDb;

export function isOsEventKind(k: string): k is OsEventKind {
  return (OS_EVENT_KINDS as readonly string[]).includes(k);
}

/** "kind:part:part". Empty parts are dropped; parts may not contain ":"-only junk. */
export function eventKey(kind: OsEventKind, ...parts: (string | number | null | undefined)[]): string {
  const rest = parts.filter((p) => p !== null && p !== undefined && String(p) !== "").map(String);
  if (!rest.length) throw new Error(`eventKey(${kind}) needs at least one part`);
  return [kind, ...rest].join(":");
}

function row(e: OsEventInput) {
  if (!isOsEventKind(e.kind)) throw new Error(`Unknown event kind ${e.kind}`);
  return {
    workspaceId: e.workspaceId,
    kind: e.kind,
    dedupeKey: e.dedupeKey,
    contactId: e.contactId ?? null,
    setterId: e.setterId ?? null,
    at: e.at ?? new Date(),
    data: e.data ?? {},
  };
}

/** Insert events, skipping keys already logged. Returns how many were new. */
export async function recordEvents(events: OsEventInput[], db: EventsDb = defaultDb()): Promise<number> {
  if (!events.length) return 0;
  // Same key twice in one batch: keep the first.
  const seen = new Set<string>();
  const rows = events.filter((e) => (seen.has(e.dedupeKey) ? false : (seen.add(e.dedupeKey), true))).map(row);
  const r = await db.osEvent.createMany({ data: rows, skipDuplicates: true });
  return r.count;
}

/** One event; true when it was new. */
export async function recordEvent(e: OsEventInput, db: EventsDb = defaultDb()): Promise<boolean> {
  return (await recordEvents([e], db)) === 1;
}

/** recordEvent that logs instead of throwing (for hooks on send paths). */
export async function recordEventQuietly(e: OsEventInput, db?: EventsDb): Promise<boolean> {
  try {
    return await recordEvent(e, db);
  } catch (err) {
    console.error(`[OS Events] could not record ${e.kind}:`, err instanceof Error ? err.message : err);
    return false;
  }
}

export async function countEvents(
  workspaceId: string,
  kind: OsEventKind,
  range: { since?: Date; until?: Date; setterId?: string | null } = {},
  db: EventsDb = defaultDb()
): Promise<number> {
  return db.osEvent.count({
    where: {
      workspaceId,
      kind,
      ...(range.since || range.until ? { at: { ...(range.since ? { gte: range.since } : {}), ...(range.until ? { lt: range.until } : {}) } } : {}),
      ...(range.setterId ? { setterId: range.setterId } : {}),
    },
  });
}
