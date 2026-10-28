import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { attachPendingNextReels } from "@/lib/automation/attach-next-reel";
import os from "node:os";
// DM OS (our fork): J's setter queue runs on the same worker process.
import { createSetterWorker } from "@/lib/os/setter/queue";
import { createSyncWorker } from "@/lib/os/integrations/queue";
import { DM_EVENTS_INTERVAL_MS, syncDmEvents } from "@/lib/os/dataos/dm-events";
import { dbDmEvents } from "@/lib/os/dataos/dm-events-db";

const worker = createDMWorker();
const setterWorker = createSetterWorker();
const syncWorker = createSyncWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
const POLL_INTERVAL_MS = Number(
  process.env.COMMENT_POLL_INTERVAL_MS ?? 5 * 60_000
);

console.log("[DM Worker] Started");

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

async function poll() {
  try {
    const attached = await attachPendingNextReels();
    if (attached.bound > 0 || attached.failedAccounts > 0) {
      console.log("[DM Worker] Next-reel attachment:", attached);
    }
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  }
}

// Kick off one sweep shortly after boot, then on a fixed interval.
setTimeout(() => void poll(), 10_000);
const pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);

// dataos-sync: workflow events → DataOS (lib/os/dataos/dm-events.ts). Off
// for every workspace without a "dataos_events" config; one tick at a time.
let dataosSyncing = false;
async function dataosSync() {
  if (dataosSyncing) return;
  dataosSyncing = true;
  try {
    for (const r of await syncDmEvents({ db: dbDmEvents })) {
      if (r.error) console.error(`[DM Worker] dataos-sync ${r.workspaceId}: ${r.error}`);
      else if (r.sent) console.log(`[DM Worker] dataos-sync ${r.workspaceId}: ${r.sent} events in ${r.posts} posts`);
    }
  } catch (error) {
    console.error("[DM Worker] dataos-sync failed:", error instanceof Error ? error.message : "Unknown error");
  } finally {
    dataosSyncing = false;
  }
}
setTimeout(() => void dataosSync(), 60_000);
const dataosTimer = setInterval(() => void dataosSync(), DM_EVENTS_INTERVAL_MS);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(pollTimer);
  clearInterval(dataosTimer);
  await worker.close();
  await setterWorker.close();
  await syncWorker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
