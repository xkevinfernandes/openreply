// Workspace switches (OsWorkspace): daily setter send limit (sendCapPerDay), Pause all, timezone,
// currency (offer prices and won amounts are read in it; no conversion).
// The row is created with defaults on first read.

import { prisma } from "@/lib/db/client";

export interface WorkspaceSettings {
  workspaceId: string;
  sendCapPerDay: number;
  pausedAll: boolean;
  timezone: string;
  /** ISO 4217, e.g. "EUR". */
  currency: string;
}

export const DEFAULT_SETTINGS: Omit<WorkspaceSettings, "workspaceId"> = {
  sendCapPerDay: 80,
  pausedAll: false,
  timezone: "Europe/Luxembourg",
  currency: "EUR",
};

/** The currencies Settings › Workspace offers. */
export const CURRENCIES = ["EUR", "USD", "GBP", "CHF", "CAD", "AUD"] as const;

/** A won amount or offer price in the workspace currency, e.g. "€1,200". */
export function formatMoney(amount: number, currency: string, locale = "en-GB"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: amount % 1 ? 2 : 0 }).format(amount);
  } catch {
    return `${amount} ${currency}`;
  }
}

export const SEND_CAP_MAX = 500;

/** A row as storage returns it (older fakes have no currency). */
export type SettingsRow = Omit<WorkspaceSettings, "currency"> & { currency?: string | null };

export interface SettingsDb {
  osWorkspace: {
    upsert(args: { where: { workspaceId: string }; create: object; update: object }): Promise<SettingsRow>;
  };
}

const defaultDb = () => prisma as unknown as SettingsDb;

export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export type SettingsPatch = Partial<Omit<WorkspaceSettings, "workspaceId">>;

/** Clean a patch from a form; returns an error for anything out of range. */
export function validatePatch(input: Record<string, unknown>): { patch: SettingsPatch } | { error: string } {
  const patch: SettingsPatch = {};
  if (input.sendCapPerDay !== undefined) {
    const n = Number(input.sendCapPerDay);
    if (!Number.isInteger(n) || n < 1 || n > SEND_CAP_MAX) return { error: `The daily setter send limit must be a whole number from 1 to ${SEND_CAP_MAX}.` };
    patch.sendCapPerDay = n;
  }
  if (input.pausedAll !== undefined) {
    if (typeof input.pausedAll !== "boolean") return { error: "Pause all must be on or off." };
    patch.pausedAll = input.pausedAll;
  }
  if (input.timezone !== undefined) {
    if (typeof input.timezone !== "string" || !isValidTimezone(input.timezone)) return { error: "Unknown timezone." };
    patch.timezone = input.timezone;
  }
  if (input.currency !== undefined) {
    const c = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(c)) return { error: "Pick a currency." };
    patch.currency = c;
  }
  return { patch };
}

function view(r: SettingsRow): WorkspaceSettings {
  return { workspaceId: r.workspaceId, sendCapPerDay: r.sendCapPerDay, pausedAll: r.pausedAll, timezone: r.timezone, currency: r.currency ?? DEFAULT_SETTINGS.currency };
}

export async function getWorkspaceSettings(workspaceId: string, db: SettingsDb = defaultDb()): Promise<WorkspaceSettings> {
  const r = await db.osWorkspace.upsert({ where: { workspaceId }, create: { workspaceId }, update: {} });
  return view(r);
}

export async function updateWorkspaceSettings(
  workspaceId: string,
  input: Record<string, unknown>,
  db: SettingsDb = defaultDb()
): Promise<WorkspaceSettings | { error: string }> {
  const v = validatePatch(input);
  if ("error" in v) return v;
  const r = await db.osWorkspace.upsert({ where: { workspaceId }, create: { workspaceId, ...v.patch }, update: v.patch });
  return view(r);
}

export async function setPausedAll(workspaceId: string, pausedAll: boolean, db: SettingsDb = defaultDb()): Promise<WorkspaceSettings> {
  const r = await db.osWorkspace.upsert({ where: { workspaceId }, create: { workspaceId, pausedAll }, update: { pausedAll } });
  return view(r);
}

/** For the worker: is this workspace paused? Fails open to "not paused" only
 *  when the read itself fails, and logs it. */
export async function isPausedAll(workspaceId: string, db: SettingsDb = defaultDb()): Promise<boolean> {
  try {
    return (await getWorkspaceSettings(workspaceId, db)).pausedAll;
  } catch (err) {
    console.error("[OS Settings] could not read Pause all:", err instanceof Error ? err.message : err);
    return false;
  }
}
