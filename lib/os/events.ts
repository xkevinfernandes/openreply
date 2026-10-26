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
  range: { since?: Date; until?: Date; setterId?: string | null; /** data.source, e.g. "setter" for dm_sent. */ source?: string } = {},
  db: EventsDb = defaultDb()
): Promise<number> {
  return db.osEvent.count({
    where: {
      workspaceId,
      kind,
      ...(range.since || range.until ? { at: { ...(range.since ? { gte: range.since } : {}), ...(range.until ? { lt: range.until } : {}) } } : {}),
      ...(range.setterId ? { setterId: range.setterId } : {}),
      ...(range.source ? { data: { path: ["source"], equals: range.source } } : {}),
    },
  });
}

// --- Won amount and offer (dm-crm: Won picker, revenue) ---------------------------
// Stored in the data of the contact's one won event (dedupeKey won:<contactId>),
// no new table. The stage-changed hook and the metrics back-fill create that
// event with skipDuplicates, so they never overwrite data already there.

export interface WonData {
  /** The offer they bought (a setter's structured offer name, or typed). */
  offer: string;
  /** In the workspace currency (OsWorkspace.currency). */
  amount: number;
  /** When this win happened (the event's own time is fixed at the first win). */
  wonAt: string;
}

/** The won data in an event's data, or null when there is no amount. */
export function wonDataOf(data: unknown): WonData | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const amount = typeof d.amount === "number" ? d.amount : typeof d.amount === "string" && d.amount.trim() ? Number(d.amount) : NaN;
  if (!Number.isFinite(amount)) return null;
  return { offer: typeof d.offer === "string" ? d.offer : "", amount, wonAt: typeof d.wonAt === "string" ? d.wonAt : "" };
}

/** The slice of a Prisma client (or transaction) the won data uses. */
export interface WonDb {
  osEvent: {
    findUnique(args: { where: { dedupeKey: string }; select: { id: true; data: true } }): Promise<{ id: string; data: unknown } | null>;
    create(args: { data: object }): Promise<unknown>;
    update(args: { where: { id: string }; data: { data: object } }): Promise<unknown>;
  };
}

const KEEP = (data: unknown): Record<string, unknown> => (data && typeof data === "object" && !Array.isArray(data) ? { ...(data as Record<string, unknown>) } : {});

/**
 * Marking Won records the offer and amount: creates the contact's won event
 * with them, or adds them to the one already there. Always writes wonAt.
 */
export async function setWonData(
  input: { workspaceId: string; contactId: string; setterId?: string | null; offer: string; amount: number; wonAt?: Date },
  db: WonDb = prisma as unknown as WonDb
): Promise<WonData> {
  const wonAt = (input.wonAt ?? new Date()).toISOString();
  const won: WonData = { offer: input.offer.trim(), amount: input.amount, wonAt };
  const key = eventKey("won", input.contactId);
  const cur = await db.osEvent.findUnique({ where: { dedupeKey: key }, select: { id: true, data: true } });
  if (cur) await db.osEvent.update({ where: { id: cur.id }, data: { data: { ...KEEP(cur.data), ...won } } });
  else
    await db.osEvent.create({
      data: { workspaceId: input.workspaceId, contactId: input.contactId, setterId: input.setterId ?? null, kind: "won", dedupeKey: key, at: new Date(wonAt), data: won },
    });
  return won;
}

/** Leaving Won clears the amount and offer (the event stays as history). */
export async function clearWonData(contactId: string, db: WonDb = prisma as unknown as WonDb): Promise<boolean> {
  const cur = await db.osEvent.findUnique({ where: { dedupeKey: eventKey("won", contactId) }, select: { id: true, data: true } });
  if (!cur) return false;
  const data = KEEP(cur.data);
  if (!("amount" in data) && !("offer" in data) && !("wonAt" in data)) return false;
  delete data.amount;
  delete data.offer;
  delete data.wonAt;
  await db.osEvent.update({ where: { id: cur.id }, data: { data } });
  return true;
}
