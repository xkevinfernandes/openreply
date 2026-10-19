// Put a broadcast send on the os-setter worker at its time. The worker's
// os-broadcast-send slot (lib/os/setter/queue.ts) calls sendBroadcastJob
// (lib/os/broadcasts/send.ts), which re-checks everything at send time.

import type { BroadcastSendJob } from "@/lib/os/broadcasts/types";

/** Returns false when there is no worker queue (no Redis): nothing will send by itself. */
export async function enqueueBroadcastSend(job: BroadcastSendJob, atMs: number): Promise<boolean> {
  // Lazy: queue.ts pulls in the whole setter.
  const { getSetterQueue, redisConfigured, SETTER_BROADCAST_SEND_JOB } = await import("@/lib/os/setter/queue");
  if (!redisConfigured()) return false;
  const delay = Math.max(0, atMs - Date.now());
  // The time is in the id: a message moved to a new time gets a new job; the
  // old one finds the time changed and does nothing.
  await getSetterQueue().add(SETTER_BROADCAST_SEND_JOB, { ...job, at: atMs }, { delay, jobId: `broadcast_${job.messageId}_${job.part}_${atMs}` });
  return true;
}
