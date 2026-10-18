// J on the BullMQ worker. Its own queue ("os-setter") so upstream's DM queue
// and its job union stay untouched. Flow (spec item 8):
//   Zernio webhook → queueSetterForInbound (upsert Contact, debounce)
//   → os-setter job → draftForContact → Draft shows in the Inbox
// After every evaluation the next timer (value opener, nudge) is scheduled as
// a delayed job, which replaces the Python polling loop.

import { Queue, Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import { upsertContact } from "@/lib/os/contacts";
import { getSetterConfig } from "@/lib/os/setter/config";
import { draftForContact } from "@/lib/os/setter/service";
import type { SetterRecord } from "@/lib/os/setter/state";
import { getRedisConnection } from "@/lib/queue/client";

export const SETTER_QUEUE = "os-setter";
export const SETTER_DRAFT_JOB = "os-setter-draft";

export interface SetterDraftJob {
  contactId: string;
  reason: "inbound" | "timer" | "manual";
}

let queue: Queue<SetterDraftJob> | null = null;

function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export function getSetterQueue(): Queue<SetterDraftJob> {
  queue ??= new Queue<SetterDraftJob>(SETTER_QUEUE, {
    connection: getRedisConnection(),
    defaultJobOptions: {
      // Job ids are reused (debounce / timer keys), so finished jobs must not linger.
      removeOnComplete: true,
      removeOnFail: { age: 3600 },
      attempts: 2,
      backoff: { type: "exponential", delay: 30_000 },
    },
  });
  return queue;
}

export async function enqueueSetterDraft(job: SetterDraftJob, opts: { delayMs?: number; jobId?: string } = {}) {
  if (!redisConfigured()) return;
  await getSetterQueue().add(SETTER_DRAFT_JOB, job, {
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
    ...(opts.jobId ? { jobId: opts.jobId } : {}),
  });
}

/** Schedule the record's next timer (value opener / nudge) as a delayed job. */
export async function scheduleNextAction(contactId: string, rec: SetterRecord) {
  const at = rec.next_action?.at ? new Date(rec.next_action.at).getTime() : null;
  if (!at || rec.next_action.kind === "reply") return;
  const delayMs = at - Date.now();
  if (delayMs <= 0) return;
  await enqueueSetterDraft({ contactId, reason: "timer" }, { delayMs: delayMs + 5_000, jobId: `timer_${contactId}_${at}` });
}

/**
 * The webhook hook: someone DM'd or tapped a button. Records the contact and
 * queues a draft a little later, so a burst of bubbles is read as one turn.
 * Never throws: J must not break upstream's webhook processing.
 */
export async function queueSetterForInbound(event: {
  workspaceId: string;
  /** Our InstagramAccount.id (not the Instagram id). */
  instagramAccountId: string;
  igUserId: string;
}) {
  try {
    const commented = await prisma.dmLog.findFirst({
      where: { instagramAccountId: event.instagramAccountId, commenterId: event.igUserId },
      select: { id: true },
    });
    const contact = await upsertContact({
      workspaceId: event.workspaceId,
      instagramAccountId: event.instagramAccountId,
      igUserId: event.igUserId,
      entryPath: commented ? "comment" : null,
    });
    if (contact.kind !== "SALES" || contact.paused) return;
    const debounceMs = getSetterConfig().debounce_seconds * 1000;
    const bucket = Math.floor(Date.now() / debounceMs);
    await enqueueSetterDraft({ contactId: contact.id, reason: "inbound" }, { delayMs: debounceMs, jobId: `inbound_${contact.id}_${bucket}` });
  } catch (error) {
    console.error("[OS Setter] could not queue a draft:", error instanceof Error ? error.message : error);
  }
}

async function processSetterJob(job: Job<SetterDraftJob>) {
  const { contactId } = job.data;
  const result = await draftForContact(contactId, { onState: (rec) => scheduleNextAction(contactId, rec) });
  console.log(`[OS Setter] ${contactId} (${job.data.reason}): ${result.status}${"reason" in result ? ` — ${result.reason}` : ""}`);
}

export function createSetterWorker(): Worker<SetterDraftJob> {
  const worker = new Worker<SetterDraftJob>(SETTER_QUEUE, processSetterJob, {
    connection: getRedisConnection(),
    // One model call at a time per worker keeps cost and rate limits predictable.
    concurrency: 2,
  });
  worker.on("failed", (job, err) => console.error(`[OS Setter] job ${job?.id} failed:`, err.message));
  return worker;
}
