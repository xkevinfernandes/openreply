// The sync on the BullMQ worker: its own "os-sync" queue, registered next to
// os-setter in worker/dm-worker.ts. Without Redis (local dev) the push runs
// inline instead.
import { Queue, Worker, type Job } from "bullmq";
import { getRedisConnection } from "@/lib/queue/client";
import { syncContact, type SyncJobInput } from "./engine";
import type { SyncEvent } from "./mapping";
import { activeProviders } from "./store";

export const SYNC_QUEUE = "os-sync";
export const SYNC_JOB = "os-sync-contact";
/** Events on one contact inside this window become one push. */
const COALESCE_MS = 5_000;

let queue: Queue<SyncJobInput> | null = null;

function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export function getSyncQueue(): Queue<SyncJobInput> {
  queue ??= new Queue<SyncJobInput>(SYNC_QUEUE, {
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

/**
 * Something changed on a contact: push it to every connected provider.
 * Never throws (a CRM must not break the inbox or the webhook).
 */
export async function fireContactEvent(event: { workspaceId: string; contactId: string; event: SyncEvent }) {
  try {
    const providers = await activeProviders(event.workspaceId);
    if (!providers.length) return;
    if (!redisConfigured()) {
      for (const provider of providers) {
        await syncContact({ ...event, provider }).catch((err) =>
          console.error(`[OS Sync] ${provider} ${event.contactId}:`, err instanceof Error ? err.message : err)
        );
      }
      return;
    }
    const bucket = Math.floor(Date.now() / COALESCE_MS);
    await getSyncQueue().addBulk(
      providers.map((provider) => ({
        name: SYNC_JOB,
        data: { ...event, provider },
        // The job reads the contact fresh, so one job per window is enough.
        opts: { jobId: `sync_${provider}_${event.contactId}_${bucket}`, delay: COALESCE_MS },
      }))
    );
  } catch (error) {
    console.error("[OS Sync] could not queue:", error instanceof Error ? error.message : error);
  }
}

/** "Sync existing contacts": queue every contact for one provider, spaced out. */
export async function enqueueBackfill(workspaceId: string, provider: SyncJobInput["provider"], contactIds: string[]) {
  if (!contactIds.length) return 0;
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

async function processSyncJob(job: Job<SyncJobInput>) {
  const result = await syncContact(job.data);
  if (result.status !== "unchanged") {
    console.log(`[OS Sync] ${job.data.provider} ${job.data.contactId} (${job.data.event}): ${result.status}${"reason" in result ? ` — ${result.reason}` : ""}`);
  }
}

export function createSyncWorker(): Worker<SyncJobInput> {
  const worker = new Worker<SyncJobInput>(SYNC_QUEUE, processSyncJob, { connection: getRedisConnection(), concurrency: 2 });
  worker.on("failed", (job, err) => console.error(`[OS Sync] job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message));
  return worker;
}
