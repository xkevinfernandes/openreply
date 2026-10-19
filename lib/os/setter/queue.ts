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
import type { BroadcastSendJob } from "@/lib/os/broadcasts/types";
import { isPausedAll } from "@/lib/os/workspace-settings";

export const SETTER_QUEUE = "os-setter";
export const SETTER_DRAFT_JOB = "os-setter-draft";
export const SETTER_TRIAGE_JOB = "os-setter-triage";
/** A follow-up step at its time (lib/os/sequences/deliver.ts). */
export const SETTER_FOLLOWUP_JOB = "os-setter-followup";
/** Wave-0 slot (owner S2): download + transcribe/describe one message's media at arrival. */
export const SETTER_MEDIA_ENRICH_JOB = "os-media-enrich";
/** Wave-0 slot (owner S5): send one approved broadcast message (lib/os/broadcasts). */
export const SETTER_BROADCAST_SEND_JOB = "os-broadcast-send";
/** Most triage calls per minute across the worker (Zernio reads + one Jev or Haiku call). */
export const TRIAGE_PER_MINUTE = 10;

export interface SetterDraftJob {
  contactId: string;
  reason: "inbound" | "timer" | "manual";
}

export interface SetterTriageJob {
  contactId: string;
  reason: "new" | "inbound" | "manual";
}

export interface SetterFollowupJob {
  stepId: string;
}

/** Save the media of a conversation's newest messages (lib/os/media/jobs.ts). */
export interface MediaEnrichJob {
  workspaceId: string;
  conversationId: string;
  /** One message; absent: the newest incoming messages. */
  messageId?: string;
}

type SetterJob = SetterDraftJob | SetterTriageJob | SetterFollowupJob | MediaEnrichJob | BroadcastSendJob;

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

/** Put a follow-up step on the worker at its time. The job id carries the
 *  time, so a step moved to a new time gets a new job; the old one finds the
 *  step changed and does nothing (deliverStep re-checks everything). */
export async function enqueueFollowupStep(stepId: string, dueAt: string) {
  if (!redisConfigured()) return;
  const at = new Date(dueAt).getTime();
  const delayMs = Math.max(0, at - Date.now()) + 2_000;
  await getSetterQueue().add(SETTER_FOLLOWUP_JOB, { stepId }, { delay: delayMs, jobId: `followup_${stepId}_${at}` });
}

/** Download + transcribe/describe at arrival, before CDN urls expire and
 *  before J's draft reads the thread. Deduped per conversation per few seconds. */
export async function enqueueMediaEnrich(job: MediaEnrichJob, opts: { delayMs?: number } = {}) {
  if (!redisConfigured()) return;
  const bucket = Math.floor(Date.now() / 5_000);
  await getSetterQueue().add(SETTER_MEDIA_ENRICH_JOB, job, {
    jobId: `media_${job.conversationId}_${job.messageId ?? bucket}`.replace(/:/g, "_"),
    delay: opts.delayMs ?? 2_000,
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
    // Their voice notes and photos are saved now (CDN urls expire); Personal
    // and Pitches threads cost nothing.
    if ((contact.kind === "SALES" || contact.kind === "UNSORTED") && contact.zernioConversationId) {
      await enqueueMediaEnrich({ workspaceId: event.workspaceId, conversationId: contact.zernioConversationId }).catch((err) =>
        console.error("[OS Media] could not queue enrich:", err instanceof Error ? err.message : err)
      );
    }
    // Pitches: J never drafts or re-sorts on its own (Re-sort pitches does).
    if (contact.kind === "PITCHES") return;
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
  const result = await triageContact(job.data.contactId, { manual: job.data.reason === "manual" });
  console.log(
    `[OS Setter] triage ${job.data.contactId} (${job.data.reason}): ${result.status}` +
      (result.status === "suggested" ? ` ${result.kind} — ${result.reason}` : result.status === "clear" ? "" : ` — ${result.reason}`)
  );
}

async function processFollowupJob(job: Job<SetterFollowupJob>) {
  // Lazy: the sequences engine imports this module for its scheduling.
  const { deliverStep } = await import("@/lib/os/sequences/deliver");
  const result = await deliverStep(job.data.stepId);
  console.log(`[OS Follow-ups] step ${job.data.stepId}: ${result.status}${"reason" in result ? ` — ${result.reason}` : ""}`);
}

async function processMediaEnrichJob(job: Job<MediaEnrichJob>) {
  // Lazy: provider adapters and Zernio reads only load on the worker.
  const { enrichConversation } = await import("@/lib/os/media/jobs");
  const r = await enrichConversation(job.data);
  console.log(`[OS Media] ${job.data.conversationId}: ${r.enriched} enriched${r.skipped ? ` (${r.skipped})` : ""}`);
}

/** Wave-0 slot: S5 replaces this with lib/os/broadcasts send (through the cap guard). */
async function processBroadcastSendJob(job: Job<BroadcastSendJob>) {
  console.log(`[OS Broadcasts] send ${job.data.messageId} (${job.data.part}): not built yet`);
}

/** Pause all (OsWorkspace.pausedAll) stops every draft job. */
async function pausedFor(contactId: string): Promise<boolean> {
  const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { workspaceId: true } });
  return c ? isPausedAll(c.workspaceId) : false;
}

/** While paused, a draft or follow-up job waits and re-checks (nothing is lost). */
const PAUSE_RECHECK_MS = 15 * 60_000;
async function holdWhilePaused(job: Job<SetterJob>, token?: string): Promise<never> {
  console.log(`[OS Setter] ${job.name} ${job.id}: Pause all is on, retrying in 15 min`);
  await job.moveToDelayed(Date.now() + PAUSE_RECHECK_MS, token);
  throw new DelayedError();
}

async function processSetterJob(job: Job<SetterJob>, token?: string) {
  if (job.name === SETTER_TRIAGE_JOB) return processTriageJob(job as Job<SetterTriageJob>, token);
  if (job.name === SETTER_MEDIA_ENRICH_JOB) return processMediaEnrichJob(job as Job<MediaEnrichJob>);
  if (job.name === SETTER_BROADCAST_SEND_JOB) return processBroadcastSendJob(job as Job<BroadcastSendJob>);
  if (job.name === SETTER_FOLLOWUP_JOB) {
    const step = await prisma.followupStep.findUnique({ where: { id: (job.data as SetterFollowupJob).stepId }, select: { workspaceId: true } });
    if (step && (await isPausedAll(step.workspaceId))) return holdWhilePaused(job, token);
    return processFollowupJob(job as Job<SetterFollowupJob>);
  }
  const { contactId } = job.data as SetterDraftJob;
  if (await pausedFor(contactId)) return holdWhilePaused(job, token);
  const result = await draftForContact(contactId, { onState: (rec) => scheduleNextAction(contactId, rec) });
  console.log(`[OS Setter] ${contactId} (${(job.data as SetterDraftJob).reason}): ${result.status}${"reason" in result ? ` — ${result.reason}` : ""}`);
  // Every look at the thread re-plans its follow-up: a reply stops a sequence at once.
  const { syncFollowupsQuietly } = await import("@/lib/os/sequences/engine");
  await syncFollowupsQuietly(contactId);
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
