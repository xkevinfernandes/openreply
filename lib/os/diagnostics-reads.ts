// The reads behind Diagnostics. diagnosticsDetails is the one shared reads
// function both diagnostics routes call (/api/admin/diagnostics and
// /api/os/diagnostics); readChecks turns our own state into the health list.
// Every read is scoped to the caller's workspace; the queue and worker only
// give counts and a heartbeat age. No call leaves for Instagram, Zernio, Kit
// or Cal.com. The connection facts come from lib/os/connections.ts, the one
// source Settings and the sidebar read too. With OS_MOCK=1 the Instagram,
// Zernio, queue and worker rows are the sample (nothing outside is asked).

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
import { readCalcom, readInstagram, readKit, readSends } from "@/lib/os/connections";
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
    const { account, zernio } = await readInstagram(workspaceId, now);
    return instagramCheck({ account, zernioReady: zernio.webhookReady, now });
  },
  async webhook(workspaceId, now) {
    const [{ account }, failedToday] = await Promise.all([
      readInstagram(workspaceId, now),
      osMockEnabled() ? 0 : prisma.webhookEvent.count({ where: { workspaceId, status: "FAILED", createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    ]);
    return webhookCheck({ connected: Boolean(account), subscribed: Boolean(account?.webhookSubscribed), failedToday });
  },
  async queue() {
    // OS_MOCK: the sample answers (the Diagnostics canvas); Redis isn't asked.
    if (osMockEnabled()) return queueCheck({ ok: true, latencyMs: 40, counts: { waiting: 0, failed: 0 } });
    return queueCheck(await queueFacts());
  },
  async worker(workspaceId, now) {
    const local = isLocalEnv();
    if (osMockEnabled()) return workerCheck({ ok: true, healthy: true, checkedAt: new Date(now.getTime() - 120_000), ageMs: 120_000, failedToday: 0, local });
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
  async zernio(workspaceId, now) {
    const { account, zernio } = await readInstagram(workspaceId, now);
    return zernioCheck({ configured: zernio.configured, webhookReady: zernio.webhookReady, used: account?.provider === "ZERNIO" });
  },
  async kit(workspaceId) {
    return kitCheck(await readKit(workspaceId));
  },
  async calcom(workspaceId) {
    return calcomCheck(await readCalcom(workspaceId));
  },
};

/** OS_MOCK's detail lists: the same quiet queue and running worker as the rows. */
export function mockDetails(now = new Date()) {
  return {
    queueCounts: { waiting: 0, active: 0, delayed: 0, failed: 0 },
    workerHealth: { healthy: true, ageMs: 120_000, heartbeat: { checkedAt: new Date(now.getTime() - 120_000).toISOString() } },
    workerAlerts: [],
    webhookFailures: [],
    dmFailures: [],
    tokenRefreshFailures: [],
    operationalEvents: [],
  };
}

/** The health list for these keys, every check in parallel, each capped at 3 s. */
export async function readChecks(workspaceId: string, keys: CheckKey[], now = new Date()): Promise<CheckRow[]> {
  return Promise.all(keys.map((k) => runCheck(k, () => READERS[k](workspaceId, now))));
}

/** "Sent today 0 / 80": the same count as the sidebar (lib/os/connections.ts). */
export async function sendingToday(workspaceId: string): Promise<{ sent: number; cap: number }> {
  const s = await readSends(workspaceId);
  return { sent: s.sent, cap: s.cap };
}
