// Settings › Diagnostics: one health list. Pure: each check turns plain facts
// into a row (tone, one line, a next step); lib/os/diagnostics-reads.ts reads
// the facts and app/api/os/diagnostics/route.ts serves them. Nothing here
// calls Instagram, Zernio, Kit or Cal.com: every fact is our own state.

import type { InstagramFix } from "@/lib/os/connections-view";
import { ago } from "@/lib/os/settings";

export const CHECK_KEYS = ["instagram", "webhook", "queue", "worker", "zernio", "kit", "calcom"] as const;
export type CheckKey = (typeof CHECK_KEYS)[number];

export const CHECK_NAMES: Record<CheckKey, string> = {
  instagram: "Instagram account",
  webhook: "Instagram webhook",
  queue: "Queue",
  worker: "Worker",
  zernio: "Zernio",
  kit: "Kit",
  calcom: "Cal.com",
};

/** good = fine, warn = look soon, bad = broken, off = not connected / not here. */
export type CheckTone = "good" | "warn" | "bad" | "off";

export interface NextStep {
  label: string;
  href?: string;
  /** Runs the Instagram fix in place (the same button as Settings › Instagram account). */
  fix?: InstagramFix;
}

export interface CheckRow {
  key: CheckKey;
  name: string;
  tone: CheckTone;
  line: string;
  next: NextStep[];
}

export const CHECK_TIMEOUT_MS = 3000;

export function isCheckKey(v: unknown): v is CheckKey {
  return typeof v === "string" && (CHECK_KEYS as readonly string[]).includes(v);
}

/** "?only=worker,webhook,token": the keys asked for ("token" = the Instagram account). */
export function parseOnly(raw: string | null | undefined): CheckKey[] {
  if (!raw) return [...CHECK_KEYS];
  const keys = raw
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .map((k) => (k === "token" ? "instagram" : k))
    .filter(isCheckKey);
  return keys.length ? [...new Set(keys)] : [...CHECK_KEYS];
}

const row = (key: CheckKey, tone: CheckTone, line: string, next: NextStep[] = []): CheckRow => ({ key, name: CHECK_NAMES[key], tone, line, next });

const RECONNECT: NextStep = { label: "Reconnect", href: "/os/settings?tab=instagram", fix: "connect" };
const FIX_WEBHOOK: NextStep = { label: "Fix webhook", href: "/os/settings?tab=instagram", fix: "webhook" };
const SET_UP_ZERNIO: NextStep = { label: "Set up Zernio", href: "/os/settings?tab=instagram#zernio", fix: "zernio" };
const LOGS: NextStep = { label: "Open DM logs", href: "/os/settings?tab=logs" };
const INTEGRATIONS: NextStep = { label: "Open Integrations", href: "/os/settings?tab=integrations" };

const day = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** A check that didn't finish in time. */
export function timedOut(key: CheckKey): CheckRow {
  return row(key, "warn", `Didn't answer in ${CHECK_TIMEOUT_MS / 1000} s`);
}

export interface InstagramFacts {
  account: { username: string; provider: string; tokenExpiresAt: Date | null; zernioAccountId: string | null } | null;
  zernioReady: boolean;
  now: Date;
}

export function instagramCheck({ account, zernioReady, now }: InstagramFacts): CheckRow {
  if (!account) return row("instagram", "bad", "No account connected", [RECONNECT]);
  if (account.provider === "ZERNIO") {
    if (!zernioReady) return row("instagram", "bad", `@${account.username} · Zernio isn't set up`, [SET_UP_ZERNIO]);
    if (!account.zernioAccountId) return row("instagram", "bad", `@${account.username} · not linked in Zernio`, [RECONNECT]);
    return row("instagram", "good", `@${account.username} · connected through Zernio`);
  }
  const exp = account.tokenExpiresAt;
  if (exp && exp.getTime() < now.getTime()) return row("instagram", "bad", `@${account.username} · token expired ${day(exp)}`, [RECONNECT]);
  if (exp && exp.getTime() - now.getTime() < 7 * 86_400_000) return row("instagram", "warn", `@${account.username} · token runs out ${day(exp)}`, [RECONNECT]);
  return row("instagram", "good", exp ? `@${account.username} · token valid until ${day(exp)}` : `@${account.username} · connected`);
}

export interface WebhookFacts {
  connected: boolean;
  subscribed: boolean;
  /** Failed webhook events in the last 24 h (this workspace). */
  failedToday: number;
}

export function webhookCheck({ connected, subscribed, failedToday }: WebhookFacts): CheckRow {
  if (!connected) return row("webhook", "off", "No account connected");
  if (!subscribed) return row("webhook", "bad", "Not subscribed, so new DMs and comments don't arrive", [FIX_WEBHOOK]);
  if (failedToday) return row("webhook", "warn", `${failedToday} event${failedToday === 1 ? "" : "s"} failed today`, [LOGS]);
  return row("webhook", "good", "Subscribed · events arriving");
}

export type QueueFacts =
  | { ok: true; latencyMs: number; counts: Partial<Record<"waiting" | "active" | "delayed" | "failed", number>> }
  | { ok: false; local: boolean };

const REDIS_LOCAL = "Redis isn't running locally";

export function queueCheck(f: QueueFacts): CheckRow {
  if (!f.ok) return f.local ? row("queue", "off", REDIS_LOCAL) : row("queue", "bad", "No answer from Redis · DMs can't send", [LOGS]);
  const waiting = (f.counts.waiting ?? 0) + (f.counts.delayed ?? 0);
  const failed = f.counts.failed ?? 0;
  const parts = [`Answered in ${Math.round(f.latencyMs)} ms`];
  if (waiting) parts.push(`${waiting} waiting`);
  if (failed) parts.push(`${failed} failed`);
  if (failed || waiting > 50) return row("queue", "warn", parts.join(" · "), [LOGS]);
  return row("queue", "good", parts.join(" · "));
}

export type WorkerFacts =
  | { ok: true; healthy: boolean; checkedAt: Date | null; ageMs: number | null; failedToday: number; local: boolean; restartUrl?: string | null }
  | { ok: false; local: boolean };

export function workerCheck(f: WorkerFacts): CheckRow {
  if (!f.ok) return f.local ? row("worker", "off", REDIS_LOCAL) : row("worker", "bad", "Can't read its heartbeat (Redis didn't answer)", [LOGS]);
  if (!f.healthy) {
    const since = f.checkedAt ? `Hasn't checked in since ${clock(f.checkedAt)}` : "Hasn't checked in";
    const fix: NextStep = f.local ? { label: "Start it with `npm run worker`" } : { label: "Restart the worker on Railway", ...(f.restartUrl ? { href: f.restartUrl } : {}) };
    return row("worker", "bad", `${since} · DMs wait in the queue until it's back`, [fix, LOGS]);
  }
  const line = `Last ran ${ago(f.ageMs)} · ${f.failedToday} failed job${f.failedToday === 1 ? "" : "s"} today`;
  return row("worker", f.failedToday ? "warn" : "good", line, f.failedToday ? [LOGS] : []);
}

export interface ZernioFacts {
  configured: boolean;
  webhookReady: boolean;
  /** The Instagram account goes through Zernio. */
  used: boolean;
}

export function zernioCheck({ configured, webhookReady, used }: ZernioFacts): CheckRow {
  if (!configured) return used ? row("zernio", "bad", "No key saved", [SET_UP_ZERNIO]) : row("zernio", "off", "Not connected");
  if (!webhookReady) return row("zernio", "bad", "Key saved · webhook not set up", [SET_UP_ZERNIO]);
  return row("zernio", "good", "Connected · inbox access");
}

export interface KitFacts {
  connected: boolean;
  lastSyncedAt: Date | null;
  errors: number;
  lastError: string | null;
}

export function kitCheck({ connected, lastSyncedAt, errors, lastError }: KitFacts): CheckRow {
  if (!connected) return row("kit", "off", "Not connected");
  const next: NextStep[] = [{ label: "Sync now", href: "/os/settings?tab=integrations" }];
  if (lastError) return row("kit", "bad", lastError, [{ label: "Replace key", href: "/os/settings?tab=integrations" }]);
  const sync = lastSyncedAt ? `Last sync ${clock(lastSyncedAt)}` : "Nothing synced yet";
  if (errors) return row("kit", "warn", `${sync} · ${errors} error${errors === 1 ? "" : "s"}`, next);
  return row("kit", "good", `${sync} · 0 errors`, lastSyncedAt ? [] : next);
}

export interface CalcomFacts {
  connected: boolean;
  lastError: string | null;
  lastBookingAt: Date | null;
}

export function calcomCheck({ connected, lastError, lastBookingAt }: CalcomFacts): CheckRow {
  if (!connected) return row("calcom", "off", "Not connected");
  if (lastError) return row("calcom", "bad", lastError, [INTEGRATIONS]);
  return row("calcom", "good", lastBookingAt ? `Bookings arriving · last ${day(lastBookingAt)}` : "Connected · no bookings yet");
}

/** The header: "Checked just now · 1 problem". Only bad rows are problems. */
export function diagnosticsSummary(rows: Pick<CheckRow, "tone">[]): { problems: number; tone: "good" | "warn" | "bad"; text: string } {
  const problems = rows.filter((r) => r.tone === "bad").length;
  const warns = rows.filter((r) => r.tone === "warn").length;
  return {
    problems,
    tone: problems ? "bad" : warns ? "warn" : "good",
    text: problems ? `${problems} problem${problems === 1 ? "" : "s"}` : "Everything's running",
  };
}

/** "Checked just now" / "Checked 4 min ago". */
export function checkedLabel(at: number | null, now: number): string {
  if (at == null) return "Checking…";
  const s = Math.round((now - at) / 1000);
  return s < 45 ? "Checked just now" : `Checked ${ago(now - at)}`;
}

/** Run one check with the 3 s cap: a late one becomes "Didn't answer in 3 s". */
export async function runCheck(key: CheckKey, work: () => Promise<CheckRow>, ms = CHECK_TIMEOUT_MS): Promise<CheckRow> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<CheckRow>((resolve) => {
    timer = setTimeout(() => resolve(timedOut(key)), ms);
  });
  try {
    return await Promise.race([work().catch((e: unknown) => row(key, "bad", e instanceof Error ? e.message : "Check failed")), late]);
  } finally {
    clearTimeout(timer);
  }
}
