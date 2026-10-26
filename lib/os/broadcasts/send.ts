// Sending one broadcast message: the os-broadcast-send job at its time, or
// "Send now" on the Follow-ups timeline. Everything is checked again here:
//   - only an approved/scheduled message goes (nothing without Approve)
//   - still tagged, not paused, not Personal/Pitches
//   - Pause all holds it (the job re-checks in 15 min while the window lasts)
//   - still inside their free 24h window (no HUMAN_AGENT broadcasts)
//   - the daily cap, through lib/os/inbox.ts sendReply (every bubble counts)
// The follow-up goes a few minutes later, unless they replied in between.

import { stillInWindow, excludedReason } from "@/lib/os/broadcasts/audience";
import { enqueueBroadcastSend } from "@/lib/os/broadcasts/jobs";
import { followupDelayMs, seededRng, windowBounds } from "@/lib/os/broadcasts/schedule";
import { broadcastStore, type BroadcastStore } from "@/lib/os/broadcasts/store";
import type { BroadcastContact, BroadcastSendJob } from "@/lib/os/broadcasts/types";
import { capState, checkSend, SendBlockedError } from "@/lib/os/sending/cap";
import { getSetterConfig } from "@/lib/os/setter/config";

export const PAUSE_RECHECK_MS = 15 * 60_000;

export type SendOutcome =
  | { status: "sent"; followupAt: number | null }
  | { status: "held"; retryAt: number | null; reason: string }
  | { status: "skipped" | "failed" | "outside_window" | "stale"; reason: string };

export interface SendDeps {
  store?: BroadcastStore;
  now?: Date;
  /** One bubble out (cap-guarded). Defaults to lib/os/inbox.ts sendReply. */
  sendBubble?: (workspaceId: string, contact: BroadcastContact, text: string, key: string) => Promise<void>;
  cap?: (workspaceId: string, now: Date) => Promise<{ sentToday: number; cap: number; pausedAll: boolean }>;
  enqueue?: typeof enqueueBroadcastSend;
}

async function defaultSendBubble(workspaceId: string, contact: BroadcastContact, text: string, key: string) {
  const { sendReply } = await import("@/lib/os/inbox");
  if (!contact.igUserId) throw new Error("No Instagram id for this contact.");
  await sendReply(workspaceId, contact.igUserId, text, { conversationId: contact.conversationId, contactId: contact.contactId, sendKey: key, source: "broadcast" });
}

/**
 * Send one part of one message. `manual` = Send now (an approved message may
 * go before its time; problems come back as errors instead of new jobs).
 */
export async function sendBroadcastPart(job: BroadcastSendJob, opts: { manual?: boolean } = {}, deps: SendDeps = {}): Promise<SendOutcome> {
  const store = deps.store ?? broadcastStore();
  const now = deps.now ?? new Date();
  const enqueue = deps.enqueue ?? enqueueBroadcastSend;
  const sendBubble = deps.sendBubble ?? defaultSendBubble;
  const cap = deps.cap ?? (async (w: string, n: Date) => capState(w, { now: n }));

  const m = await store.getMessage(job.messageId);
  if (!m) return { status: "stale", reason: "Message gone." };
  const run = await store.getRunById(m.runId);
  const b = run ? await store.getById(run.broadcastId) : null;
  if (!run || !b) return { status: "stale", reason: "Run gone." };
  const workspaceId = m.workspaceId;
  const fail = async (status: "skipped" | "failed" | "outside_window", reason: string): Promise<SendOutcome> => {
    if (job.part === "main" && !opts.manual) await store.updateMessage(m.id, { status, error: reason });
    else if (job.part === "followup") await store.updateMessage(m.id, { error: `Follow-up not sent: ${reason}` });
    return { status, reason };
  };

  // 1. Approved, and the job is the one for its current time.
  if (job.part === "main") {
    const allowed = opts.manual ? m.status === "approved" || m.status === "scheduled" : m.status === "scheduled";
    if (!allowed) return { status: "stale", reason: `Status is ${m.status}.` };
    if (!opts.manual && job.at && m.scheduledAt && new Date(m.scheduledAt).getTime() !== job.at) return { status: "stale", reason: "Moved to a new time." };
  } else if (m.status !== "sent" || !m.followupBubbles.length) {
    return { status: "stale", reason: "Nothing to follow up." };
  }

  // 2. Still someone we broadcast to.
  const contact = await store.contact(workspaceId, m.contactId);
  if (!contact) return fail("skipped", "Contact gone");
  if (!contact.tags.includes(b.audienceTag)) return fail("skipped", "Left the audience");
  const ex = excludedReason(contact);
  if (ex) return fail("skipped", ex);
  if (job.part === "followup" && m.sentAt && contact.theirLastAt && new Date(contact.theirLastAt) > new Date(m.sentAt)) {
    return fail("skipped", "they replied");
  }

  // 3. Pause all: hold, re-check later while the send window lasts.
  const bubbles = job.part === "main" ? m.bubbles : m.followupBubbles;
  const state = await cap(workspaceId, now);
  if (state.pausedAll) {
    if (opts.manual) return { status: "held", retryAt: null, reason: "Pause all is on." };
    const { end } = windowBounds(run.runDate, b.windowStart, b.windowEnd, b.timezone);
    const retry = now.getTime() + PAUSE_RECHECK_MS;
    if (retry < end.getTime() && stillInWindow(contact.theirLastAt, new Date(retry), getSetterConfig())) {
      if (job.part === "main") await store.updateMessage(m.id, { scheduledAt: new Date(retry).toISOString() });
      await enqueue({ messageId: m.id, part: job.part }, retry);
      return { status: "held", retryAt: retry, reason: "Pause all is on." };
    }
    return fail("failed", "Pause all was on for the whole window");
  }

  // 4. The 24h window, right now. No HUMAN_AGENT.
  if (!stillInWindow(contact.theirLastAt, now, getSetterConfig())) return fail("outside_window", "Their 24h window closed");

  // 5. The cap, for the whole part up front (sendReply checks each bubble too).
  if (checkSend(state, bubbles.length) === "cap") {
    if (opts.manual) return { status: "held", retryAt: null, reason: `Today's send cap is reached (${state.sentToday}/${state.cap}).` };
    return fail("failed", "Daily send cap reached");
  }

  // 6. Out it goes, one bubble at a time; the link is its own bubble already.
  try {
    for (const [i, text] of bubbles.entries()) {
      await sendBubble(workspaceId, contact, text, `bm:${m.id}:${job.part}:${i}`);
    }
  } catch (err) {
    const reason = err instanceof SendBlockedError ? err.message : err instanceof Error ? err.message : "Send failed";
    if (job.part === "main") await store.updateMessage(m.id, { status: "failed", error: reason });
    else await store.updateMessage(m.id, { error: `Follow-up not sent: ${reason}` });
    return { status: "failed", reason };
  }

  if (job.part === "followup") return { status: "sent", followupAt: null };

  await store.updateMessage(m.id, { status: "sent", sentAt: now.toISOString(), error: null });
  let followupAt: number | null = null;
  if (m.followupBubbles.length) {
    followupAt = now.getTime() + followupDelayMs(b.followupDelayMin, seededRng(`${m.id}:fu`));
    await enqueue({ messageId: m.id, part: "followup" }, followupAt);
  }
  // The run is done when nothing is left to go.
  const left = (await store.messages(run.id)).filter((x) => x.status === "scheduled" || x.status === "approved");
  if (!left.length) await store.updateRun(run.id, { status: "done" });
  return { status: "sent", followupAt };
}

/** The worker's os-broadcast-send slot (lib/os/setter/queue.ts). */
export async function sendBroadcastJob(job: BroadcastSendJob): Promise<SendOutcome> {
  const r = await sendBroadcastPart(job);
  console.log(`[OS Broadcasts] ${job.part} ${job.messageId}: ${r.status}${"reason" in r ? ` — ${r.reason}` : ""}`);
  return r;
}
