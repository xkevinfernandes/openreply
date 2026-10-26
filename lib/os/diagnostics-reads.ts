// The reads behind Diagnostics. diagnosticsDetails is the one shared reads
// function both diagnostics routes call (/api/admin/diagnostics and
// /api/os/diagnostics); readChecks turns our own state into the health list.
// Every read is scoped to the caller's workspace; the queue and worker only
// give counts and a heartbeat age. No call leaves for Instagram, Zernio, Kit
// or Cal.com. With OS_MOCK=1 nothing is read at all (sample rows).

import { prisma } from "@/lib/db/client";
import {
  calcomCheck,
  instagramCheck,
  kitCheck,
  queueCheck,
  runCheck,
  webhookCheck,
  workerCheck,
  zernioCheck,
  type CheckKey,
  type CheckRow,
  type QueueFacts,
} from "@/lib/os/diagnostics";
import { osMockEnabled } from "@/lib/os/mock";

const DAY_MS = 86_400_000;

/** Local dev: a Redis that isn't there is "off", not a problem. */
export function isLocalEnv(): boolean {
  return process.env.NODE_ENV !== "production";
}

async function raceMs<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** The old detail lists (queue counts, heartbeat, alerts, recent failures). */
export async function diagnosticsDetails(workspaceId: string) {
  const { getDMQueue } = await import("@/lib/queue/client");
  const { getWorkerAlerts, getWorkerHealth } = await import("@/lib/ops/worker-health");
  const [queueCounts, workerHealth, workerAlerts, webhookFailures, dmFailures, tokenRefreshFailures, operationalEvents] = await Promise.all([
    getDMQueue().getJobCounts("waiting", "active", "delayed", "failed"),
    getWorkerHealth(),
    getWorkerAlerts(10),
    prisma.webhookEvent.findMany({
      where: { workspaceId, status: "FAILED" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, object: true, errorMessage: true, createdAt: true, processedAt: true },
    }),
    prisma.dmLog.findMany({
      where: { workspaceId, status: { in: ["FAILED", "SKIPPED_RATE_LIMIT", "SKIPPED_PLAN_LIMIT", "SKIPPED_NO_MATCH"] } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      select: { id: true, status: true, commentId: true, commentText: true, errorMessage: true, updatedAt: true, automation: { select: { name: true } } },
    }),
    prisma.operationalEvent.findMany({
      where: { workspaceId, source: "TOKEN_REFRESH", level: "ERROR" },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, message: true, createdAt: true, payload: true },
    }),
    prisma.operationalEvent.findMany({
      where: { OR: [{ workspaceId }, { workspaceId: null }] },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: { id: true, source: true, level: true, message: true, createdAt: true, resolvedAt: true },
    }),
  ]);
  return { queueCounts, workerHealth, workerAlerts, webhookFailures, dmFailures, tokenRefreshFailures, operationalEvents };
}

export type DiagnosticsDetails = Awaited<ReturnType<typeof diagnosticsDetails>>;

/** Redis-backed facts: none when REDIS_URL isn't set (local) or it doesn't answer. */
async function queueFacts(): Promise<QueueFacts> {
  const local = isLocalEnv();
  if (!process.env.REDIS_URL && local) return { ok: false, local };
  try {
    const { getDMQueue } = await import("@/lib/queue/client");
    const t0 = performance.now();
    const counts = await raceMs(getDMQueue().getJobCounts("waiting", "active", "delayed", "failed"), 2500);
    return { ok: true, latencyMs: performance.now() - t0, counts };
  } catch {
    return { ok: false, local };
  }
}

const startOfDay = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

const READERS: Record<CheckKey, (workspaceId: string, now: Date) => Promise<CheckRow>> = {
  async instagram(workspaceId, now) {
    const [account, zernio] = await Promise.all([
      prisma.instagramAccount.findFirst({
        where: { workspaceId },
        orderBy: { connectedAt: "desc" },
        select: { username: true, provider: true, tokenExpiresAt: true, zernioAccountId: true },
      }),
      prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } }),
    ]);
    return instagramCheck({ account, zernioReady: Boolean(zernio?.webhookId), now });
  },
  async webhook(workspaceId, now) {
    const [account, failedToday] = await Promise.all([
      prisma.instagramAccount.findFirst({ where: { workspaceId }, orderBy: { connectedAt: "desc" }, select: { webhookSubscribed: true } }),
      prisma.webhookEvent.count({ where: { workspaceId, status: "FAILED", createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    return webhookCheck({ connected: Boolean(account), subscribed: Boolean(account?.webhookSubscribed), failedToday });
  },
  async queue() {
    return queueCheck(await queueFacts());
  },
  async worker(workspaceId, now) {
    const local = isLocalEnv();
    if (!process.env.REDIS_URL && local) return workerCheck({ ok: false, local });
    try {
      const { getWorkerHealth } = await import("@/lib/ops/worker-health");
      const [health, failedToday] = await Promise.all([
        raceMs(getWorkerHealth(), 2500),
        prisma.dmLog.count({ where: { workspaceId, status: "FAILED", updatedAt: { gte: startOfDay(now) } } }),
      ]);
      return workerCheck({
        ok: true,
        healthy: health.healthy,
        checkedAt: health.heartbeat ? new Date(health.heartbeat.checkedAt) : null,
        ageMs: health.ageMs,
        failedToday,
        local,
        restartUrl: process.env.OS_WORKER_SERVICE_URL ?? null,
      });
    } catch {
      return workerCheck({ ok: false, local });
    }
  },
  async zernio(workspaceId) {
    const [conn, account] = await Promise.all([
      prisma.zernioConnection.findUnique({ where: { workspaceId }, select: { webhookId: true } }),
      prisma.instagramAccount.findFirst({ where: { workspaceId, provider: "ZERNIO" }, select: { id: true } }),
    ]);
    return zernioCheck({ configured: Boolean(conn), webhookReady: Boolean(conn?.webhookId), used: Boolean(account) });
  },
  async kit(workspaceId) {
    const [conn, row, last, errors] = await Promise.all([
      prisma.crmConnection.findUnique({ where: { workspaceId_provider: { workspaceId, provider: "KIT" } }, select: { id: true } }),
      prisma.osIntegration.findFirst({ where: { workspaceId, provider: "kit" }, select: { lastError: true } }),
      prisma.contactSync.aggregate({ where: { workspaceId, provider: "kit" }, _max: { lastSyncedAt: true } }),
      prisma.contactSync.count({ where: { workspaceId, provider: "kit", lastError: { not: null } } }),
    ]);
    return kitCheck({ connected: Boolean(conn), lastSyncedAt: last._max.lastSyncedAt ?? null, errors, lastError: row?.lastError ?? null });
  },
  async calcom(workspaceId) {
    const [row, last] = await Promise.all([
      prisma.osIntegration.findFirst({ where: { workspaceId, provider: "calcom" }, select: { credentials: true, lastError: true } }),
      prisma.booking.findFirst({ where: { workspaceId, provider: "calcom" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    return calcomCheck({ connected: Boolean(row?.credentials), lastError: row?.lastError ?? null, lastBookingAt: last?.createdAt ?? null });
  },
};

/** The sample list for OS_MOCK=1 (the Diagnostics canvas). */
export function mockChecks(keys: CheckKey[]): CheckRow[] {
  const at = new Date(Date.now() - 3 * 3600_000);
  const sample: Record<CheckKey, CheckRow> = {
    instagram: instagramCheck({ account: { username: "claudepreneur", provider: "ZERNIO", tokenExpiresAt: null, zernioAccountId: "z1" }, zernioReady: true, now: new Date() }),
    webhook: webhookCheck({ connected: true, subscribed: false, failedToday: 0 }),
    queue: queueCheck({ ok: true, latencyMs: 40, counts: { waiting: 0, failed: 0 } }),
    worker: workerCheck({ ok: true, healthy: true, checkedAt: new Date(Date.now() - 120_000), ageMs: 120_000, failedToday: 0, local: true }),
    zernio: zernioCheck({ configured: true, webhookReady: true, used: true }),
    kit: kitCheck({ connected: true, lastSyncedAt: at, errors: 0, lastError: null }),
    calcom: calcomCheck({ connected: true, lastError: null, lastBookingAt: new Date(Date.now() - 4 * DAY_MS) }),
  };
  return keys.map((k) => sample[k]);
}

/** The health list for these keys, every check in parallel, each capped at 3 s. */
export async function readChecks(workspaceId: string, keys: CheckKey[], now = new Date()): Promise<CheckRow[]> {
  if (osMockEnabled()) return mockChecks(keys);
  return Promise.all(keys.map((k) => runCheck(k, () => READERS[k](workspaceId, now))));
}

/** "Sent today 36 / 80". */
export async function sendingToday(workspaceId: string): Promise<{ sent: number; cap: number }> {
  if (osMockEnabled()) return { sent: 36, cap: 80 };
  const { capState } = await import("@/lib/os/sending/cap");
  const s = await capState(workspaceId);
  return { sent: s.sentToday, cap: s.cap };
}
