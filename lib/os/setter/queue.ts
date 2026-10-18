// J on the BullMQ worker. Its own queue ("os-setter") so upstream's DM queue
// and its job union stay untouched. Flow (spec item 8):
//   Zernio webhook → queueSetterForInbound (upsert Contact, debounce)
//   → os-setter job → draftForContact → Draft shows in the Inbox
// After every evaluation the next timer (value opener, nudge) is scheduled as
// a delayed job, which replaces the Python polling loop.
//
// Triage (spec item 7) shares the queue as its own job name: new Unsorted
// contacts get J's sales/personal guess, and a Personal contact's new message
// is checked for "move to Sales?". Triage is held to TRIAGE_PER_MINUTE.

import { DelayedError, Queue, Worker, type Job } from "bullmq";
import { prisma } from "@/lib/db/client";
import { upsertContact } from "@/lib/os/contacts";
import { getSetterConfig } from "@/lib/os/setter/config";
import { draftForContact } from "@/lib/os/setter/service";
import type { SetterRecord } from "@/lib/os/setter/state";
import { triageContact } from "@/lib/os/setter/triage";
import { getRedisConnection } from "@/lib/queue/client";

export const SETTER_QUEUE = "os-setter";
export const SETTER_DRAFT_JOB = "os-setter-draft";
export const SETTER_TRIAGE_JOB = "os-setter-triage";
/** Most triage calls per minute across the worker (Zernio reads + Haiku). */
export const TRIAGE_PER_MINUTE = 10;

export interface SetterDraftJob {
  contactId: string;
  reason: "inbound" | "timer" | "manual";
}

export interface SetterTriageJob {
  contactId: string;
  reason: "new" | "inbound" | "manual";
}

type SetterJob = SetterDraftJob | SetterTriageJob;

let queue: Queue<SetterJob> | null = null;

export function redisConfigured() {
  return Boolean(process.env.REDIS_URL);
}

export function getSetterQueue(): Queue<SetterJob> {
  queue ??= new Queue<SetterJob>(SETTER_QUEUE, {
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

/** Queue J's sales/personal look at one contact. The job id dedupes: a
 *  contact already waiting is not queued twice. */
export async function enqueueTriage(job: SetterTriageJob, opts: { delayMs?: number; jobId?: string } = {}) {
  if (!redisConfigured()) return;
  await getSetterQueue().add(SETTER_TRIAGE_JOB, job, {
    jobId: opts.jobId ?? `triage_${job.contactId}`,
    ...(opts.delayMs ? { delay: opts.delayMs } : {}),
  });
}

/** Queue many, spaced so the rate limit rarely has to push one back. */
export async function enqueueTriageMany(contactIds: string[], reason: SetterTriageJob["reason"]) {
  if (!redisConfigured() || !contactIds.length) return 0;
  const gap = Math.ceil(60_000 / TRIAGE_PER_MINUTE);
  await getSetterQueue().addBulk(
    contactIds.map((contactId, i) => ({
      name: SETTER_TRIAGE_JOB,
      data: { contactId, reason },
      opts: { jobId: `triage_${contactId}`, ...(i ? { delay: i * gap } : {}) },
    }))
  );
  return contactIds.length;
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
    const debounceMs = getSetterConfig().debounce_seconds * 1000;
    const bucket = Math.floor(Date.now() / debounceMs);
    if (contact.kind !== "SALES") {
      // Unsorted: J guesses once ("Sort with J" re-checks after new messages).
      // Personal: J only looks for an offer question. J never drafts for either.
      if (contact.kind === "UNSORTED" && contact.suggestedKind) return;
      await enqueueTriage({ contactId: contact.id, reason: "inbound" }, { delayMs: debounceMs, jobId: `triage_${contact.id}_${bucket}` });
      return;
    }
    if (contact.paused) return;
    await enqueueSetterDraft({ contactId: contact.id, reason: "inbound" }, { delayMs: debounceMs, jobId: `inbound_${contact.id}_${bucket}` });
  } catch (error) {
    console.error("[OS Setter] could not queue a draft:", error instanceof Error ? error.message : error);
  }
}

/** Fixed one-minute window shared by every worker process. Returns when to
 *  retry, or null when this call may run now. */
async function triageWait(): Promise<number | null> {
  const redis = getRedisConnection();
  const minute = Math.floor(Date.now() / 60_000);
  const key = `os-setter:triage-rate:${minute}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 120);
  if (n <= TRIAGE_PER_MINUTE) return null;
  return (minute + 1) * 60_000 + Math.floor(Math.random() * 50_000);
}

async function processTriageJob(job: Job<SetterTriageJob>, token?: string) {
  const retryAt = await triageWait();
  if (retryAt) {
    await job.moveToDelayed(retryAt, token);
    throw new DelayedError();
  }
  const result = await triageContact(job.data.contactId);
  console.log(
    `[OS Setter] triage ${job.data.contactId} (${job.data.reason}): ${result.status}` +
      (result.status === "suggested" ? ` ${result.kind} — ${result.reason}` : result.status === "skipped" ? ` — ${result.reason}` : "")
  );
}

async function processSetterJob(job: Job<SetterJob>, token?: string) {
  if (job.name === SETTER_TRIAGE_JOB) return processTriageJob(job as Job<SetterTriageJob>, token);
  const { contactId } = job.data;
  const result = await draftForContact(contactId, { onState: (rec) => scheduleNextAction(contactId, rec) });
  console.log(`[OS Setter] ${contactId} (${job.data.reason}): ${result.status}${"reason" in result ? ` — ${result.reason}` : ""}`);
}

export function createSetterWorker(): Worker<SetterJob> {
  const worker = new Worker<SetterJob>(SETTER_QUEUE, processSetterJob, {
    connection: getRedisConnection(),
    // One model call at a time per worker keeps cost and rate limits predictable.
    concurrency: 2,
  });
  worker.on("failed", (job, err) => console.error(`[OS Setter] job ${job?.id} failed:`, err.message));
  return worker;
}
