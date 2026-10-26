// The daily setter send limit and the kill switch, on every send path (plan
// "Defaults" 5). Every outgoing bubble is recorded as one OsEvent "dm_sent"
// with its source, but only J's sends (source "setter": drafts sent, approved
// or auto) count toward the limit and are held by it. Workflows, campaign
// openers, broadcasts, voice notes and Kevin's own replies don't count and are
// never blocked by it. Pause all blocks every send. "Today" is the
// workspace's local day (OsWorkspace.timezone).
//
// Usage on a send path:
//   await assertCanSend(workspaceId, 1, { source: "setter" }); // throws SendBlockedError
//   await sendTheBubble();
//   await recordSend(workspaceId, { contactId, key, source: "setter" });
// The count-then-send is not atomic: two sends racing at the cap can go one
// over. That is fine for a pacing guard.

import { randomUUID } from "node:crypto";
import { countEvents, recordEventQuietly, type EventsDb } from "@/lib/os/events";
import { getWorkspaceSettings, type SettingsDb, type WorkspaceSettings } from "@/lib/os/workspace-settings";

export type SendBlockReason = "paused" | "cap";

/** Who sent a bubble. Only "setter" counts toward the daily limit. */
export type SendSource = "setter" | "manual" | "broadcast" | "voice" | "workflow" | "campaign_opener";

export const CAPPED_SOURCE: SendSource = "setter";

export class SendBlockedError extends Error {
  constructor(
    readonly reason: SendBlockReason,
    readonly state: CapState
  ) {
    super(
      reason === "paused"
        ? "Sending is paused (Pause all). Nothing was sent."
        : `Today's setter send limit is reached (${state.sentToday}/${state.cap}). Nothing was sent; raise it in Settings or wait until tomorrow.`
    );
    this.name = "SendBlockedError";
  }
}

export interface CapState {
  /** J's sends today (the only ones the limit counts). */
  sentToday: number;
  cap: number;
  pausedAll: boolean;
  remaining: number;
  timezone: string;
}

export interface CapDeps {
  now?: Date;
  /** Who is sending (assertCanSend); defaults to "setter". */
  source?: SendSource;
  db?: EventsDb & SettingsDb;
}

/** Offset of `tz` from UTC at `at`, in ms (positive east of Greenwich). */
export function tzOffsetMs(at: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The UTC instant the local day containing `at` started, in `tz`. DST-safe. */
export function localDayStart(at: Date, tz: string): Date {
  const local = new Date(at.getTime() + tzOffsetMs(at, tz));
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // Midnight local = midnightAsUtc - offset at midnight (which may differ from now's on DST days).
  let guess = midnightAsUtc - tzOffsetMs(new Date(midnightAsUtc), tz);
  guess = midnightAsUtc - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

/** "YYYY-MM-DD" of `at` in `tz`. */
export function localDate(at: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** Pure: may `n` more bubbles go out? Only the setter's are held by the limit. */
export function checkSend(state: Pick<CapState, "sentToday" | "cap" | "pausedAll">, n = 1, source: SendSource = CAPPED_SOURCE): SendBlockReason | null {
  if (state.pausedAll) return "paused";
  if (source === CAPPED_SOURCE && state.sentToday + n > state.cap) return "cap";
  return null;
}

export function capStateFrom(settings: WorkspaceSettings, sentToday: number): CapState {
  return {
    sentToday,
    cap: settings.sendCapPerDay,
    pausedAll: settings.pausedAll,
    remaining: Math.max(0, settings.sendCapPerDay - sentToday),
    timezone: settings.timezone,
  };
}

export async function capState(workspaceId: string, deps: CapDeps = {}): Promise<CapState> {
  const now = deps.now ?? new Date();
  const settings = await getWorkspaceSettings(workspaceId, deps.db);
  const sentToday = await countEvents(workspaceId, "dm_sent", { since: localDayStart(now, settings.timezone), source: CAPPED_SOURCE }, deps.db);
  return capStateFrom(settings, sentToday);
}

/** Throws SendBlockedError when Pause all is on or `n` setter bubbles would pass the limit. */
export async function assertCanSend(workspaceId: string, n = 1, deps: CapDeps = {}): Promise<CapState> {
  const state = await capState(workspaceId, deps);
  const blocked = checkSend(state, n, deps.source ?? CAPPED_SOURCE);
  if (blocked) throw new SendBlockedError(blocked, state);
  return state;
}

/** Count one sent bubble. `key` makes a retry idempotent (e.g. "<draftId>:<i>");
 *  without it every call counts. Never throws. */
export async function recordSend(
  workspaceId: string,
  opts: { contactId?: string | null; setterId?: string | null; key?: string | null; source?: SendSource; now?: Date; db?: EventsDb } = {}
): Promise<void> {
  await recordEventQuietly(
    {
      workspaceId,
      kind: "dm_sent",
      dedupeKey: `dm_sent:${opts.key ?? randomUUID()}`,
      contactId: opts.contactId ?? null,
      setterId: opts.setterId ?? null,
      at: opts.now,
      data: opts.source ? { source: opts.source } : {},
    },
    opts.db
  );
}
