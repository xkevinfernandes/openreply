// The sync on the BullMQ worker: its own "os-sync" queue, registered next to
// os-setter in worker/dm-worker.ts. Two jobs share it:
//  - os-sync-flush: one per contact, debounced. Every write marks the contact
//    dirty and pushes the flush back, so it runs 30s after the last write
//    (five answers make one CRM call).
//  - os-sync-contact: one push to one provider, retried with backoff.
// Without Redis (local dev) the push runs inline instead. Tests and the
// sandbox never sync.
import { Queue, Worker, type Job } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";
import { syncContact, type SyncJobInput } from "./engine";
import type { SyncEvent, SyncProviderId } from "./mapping";
import { activeProviders } from "./store";

export const SYNC_QUEUE = "os-sync";
export const SYNC_JOB = "os-sync-contact";
export const FLUSH_JOB = "os-sync-flush";
/** Quiet time after the last write before a contact is pushed. */
export const QUIET_MS = 30_000;

export interface DirtyEvent {
  workspaceId: string;
  contactId: string;
  event: SyncEvent;
}

type SyncQueueData = SyncJobInput | DirtyEvent;

let queue: Queue<SyncQueueData> | null = null;

function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

/** Tests never reach a real CRM, whatever they call. */
export function syncDisabled() {
  return process.env.NODE_ENV === "test" || Boolean(process.env.VITEST) || process.env.OS_SYNC_OFF === "1";
}

export function getSyncQueue(): Queue<SyncQueueData> {
  queue ??= new Queue<SyncQueueData>(SYNC_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      removeOnComplete: true,
      removeOnFail: { age: 7 * 24 * 3600 },
      // 1, 2, 4, 8, 16 minutes: rides out a CRM outage of about half an hour.
      attempts: 6,
      backoff: { type: "exponential", delay: 60_000 },
    },
  });
  return queue;
}

/** The debounced flush: same id per contact, each write restarts the 30s. */
export function flushJobOptions(contactId: string) {
  return {
    delay: QUIET_MS,
    attempts: 1,
    deduplication: { id: `flush_${contactId}`, ttl: QUIET_MS, extend: true, replace: true },
  };
}

async function pushInline(e: DirtyEvent, providers: SyncProviderId[]) {
  for (const provider of providers) {
    await syncContact({ ...e, provider }).catch((err) => console.error(`[OS Sync] ${provider} ${e.contactId}:`, err instanceof Error ? err.message : err));
  }
}

/**
 * Something changed on a contact: push it to every connected provider once
 * it's been quiet for 30s. Never throws (a CRM must not break the inbox or
 * the webhook).
 */
export async function markDirty(e: DirtyEvent) {
  if (syncDisabled()) return;
  try {
    const providers = await activeProviders(e.workspaceId);
    if (!providers.length) return;
    if (!redisConfigured()) return pushInline(e, providers);
    await getSyncQueue().add(FLUSH_JOB, e, flushJobOptions(e.contactId));
  } catch (error) {
    console.error("[OS Sync] could not queue:", error instanceof Error ? error.message : error);
  }
}

/** The older name every caller uses; same batched push. */
export const fireContactEvent = markDirty;

/** Retry / "Sync now" on Details: push now, no quiet time. */
export async function syncNow(e: DirtyEvent) {
  if (syncDisabled()) return;
  try {
    const providers = await activeProviders(e.workspaceId);
    if (!providers.length) return;
    if (!redisConfigured()) return pushInline(e, providers);
    await enqueuePushes(e, providers);
  } catch (error) {
    console.error("[OS Sync] could not queue:", error instanceof Error ? error.message : error);
  }
}

async function enqueuePushes(e: DirtyEvent, providers: SyncProviderId[]) {
  const at = Date.now();
  await getSyncQueue().addBulk(
    providers.map((provider) => ({
      name: SYNC_JOB,
      data: { ...e, provider },
      // The job reads the contact fresh; its own id so retries back off on their own.
      opts: { jobId: `sync_${provider}_${e.contactId}_${at}` },
    }))
  );
}

/** "Sync existing contacts": queue every contact for one provider, spaced out. */
export async function enqueueBackfill(workspaceId: string, provider: SyncProviderId, contactIds: string[]) {
  if (!contactIds.length || syncDisabled()) return 0;
  if (!redisConfigured()) {
    for (const contactId of contactIds.slice(0, 25)) {
      await syncContact({ workspaceId, contactId, provider, event: "backfill" }).catch(() => {});
    }
    return Math.min(25, contactIds.length);
  }
  const day = new Date().toISOString().slice(0, 10);
  await getSyncQueue().addBulk(
    contactIds.map((contactId, i) => ({
      name: SYNC_JOB,
      data: { workspaceId, contactId, provider, event: "backfill" as const },
      // About 4 a second keeps well under Kit's and GHL's rate limits.
      opts: { jobId: `backfill_${provider}_${contactId}_${day}`, delay: i * 250 },
    }))
  );
  return contactIds.length;
}

async function processSyncJob(job: Job<SyncQueueData>) {
  if (job.name === FLUSH_JOB) {
    const e = job.data as DirtyEvent;
    const providers = await activeProviders(e.workspaceId);
    if (providers.length) await enqueuePushes(e, providers);
    return;
  }
  const data = job.data as SyncJobInput;
  const result = await syncContact(data);
  if (result.status !== "unchanged") {
    console.log(`[OS Sync] ${data.provider} ${data.contactId} (${data.event}): ${result.status}${"reason" in result ? ` — ${result.reason}` : ""}`);
  }
}

export function createSyncWorker(): Worker<SyncQueueData> {
  const worker = new Worker<SyncQueueData>(SYNC_QUEUE, processSyncJob, { connection: getRedisConnection(), concurrency: 2 });
  worker.on("failed", (job, err) => console.error(`[OS Sync] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message));
  return worker;
}
