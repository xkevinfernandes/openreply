// Email gate: ask for an email before the link, catch the reply, sync it to the
// workspace's email list, then send the link.
//
//   comment / button tap / DM keyword
//     → prompt ("what's the best email to send it to?")   EmailCapture AWAITING
//   their next DM
//     → has an email   → list sync (Kit) → link            CAPTURED
//     → no email       → one retry prompt, then the link   GAVE_UP
//
// The gate is soft on purpose: someone who will not type an email still gets
// what they asked for, after MAX_EMAIL_ATTEMPTS replies without one.
import { prisma } from "@/lib/db/client";
import { syncLead } from "@/lib/crm";

export const DEFAULT_EMAIL_PROMPT = "what's the best email to send it to?";
export const DEFAULT_EMAIL_RETRY =
  "hmm, that doesn't look like an email. what's the best one to send it to?";
/// Replies without an email before we stop asking and send the link anyway.
export const MAX_EMAIL_ATTEMPTS = 2;
/// An unanswered prompt stops claiming their DMs after this long.
export const EMAIL_GATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i;

/// The first email address in a DM, lowercased, or null. Tolerates the usual
/// "sure! it's Name@Mail.com." wrapping.
export function extractEmail(text: string | null | undefined): string | null {
  const match = (text ?? "").match(EMAIL_RE);
  return match ? match[0].toLowerCase() : null;
}

export type GateReplyOutcome =
  | { kind: "captured"; email: string }
  | { kind: "retry" }
  | { kind: "give_up" };

/// What to do with one reply, given how many replies without an email came before.
export function decideGateReply(text: string, attemptsSoFar: number): GateReplyOutcome {
  const email = extractEmail(text);
  if (email) return { kind: "captured", email };
  return attemptsSoFar + 1 >= MAX_EMAIL_ATTEMPTS ? { kind: "give_up" } : { kind: "retry" };
}

type GateAutomation = {
  id: string;
  workspaceId: string;
  instagramAccountId: string;
  requireEmail: boolean;
  emailPromptMessage: string | null;
  emailRetryMessage: string | null;
  crmTagId: string | null;
};

/// True when this person still owes us an email for this campaign.
export async function needsEmail(automation: GateAutomation, userId: string): Promise<boolean> {
  if (!automation.requireEmail) return false;
  const existing = await prisma.emailCapture.findUnique({
    where: { automationId_userId: { automationId: automation.id, userId } },
    select: { status: true },
  });
  // Once they answered (or we gave up), the gate is done for good: a second
  // comment or tap goes straight to the link.
  return !existing || existing.status === "AWAITING";
}

export function promptText(automation: GateAutomation) {
  return automation.emailPromptMessage?.trim() || DEFAULT_EMAIL_PROMPT;
}

export function retryText(automation: GateAutomation) {
  return automation.emailRetryMessage?.trim() || DEFAULT_EMAIL_RETRY;
}

/// Record that the prompt went out. Re-prompting an AWAITING capture (a second
/// comment) restarts its window but keeps its attempt count.
export async function openCapture(automation: GateAutomation, userId: string, username: string | null) {
  await prisma.emailCapture.upsert({
    where: { automationId_userId: { automationId: automation.id, userId } },
    create: {
      workspaceId: automation.workspaceId,
      automationId: automation.id,
      instagramAccountId: automation.instagramAccountId,
      userId,
      username,
    },
    update: { createdAt: new Date(), ...(username ? { username } : {}) },
  });
}

/// The open capture this DM answers, if any: newest AWAITING one for this
/// sender on this Instagram account (its Instagram id), inside the window.
export async function findOpenCapture(instagramId: string, userId: string, accountConnectionId?: string) {
  return prisma.emailCapture.findFirst({
    where: {
      userId,
      status: "AWAITING",
      createdAt: { gt: new Date(Date.now() - EMAIL_GATE_WINDOW_MS) },
      ...(accountConnectionId ? { instagramAccountId: accountConnectionId } : {}),
      automation: { isActive: true, requireEmail: true, instagramAccount: { instagramId } },
    },
    orderBy: { createdAt: "desc" },
  });
}

/// Push the email to the list and record the outcome on the capture.
export async function syncCapture(
  capture: { id: string; workspaceId: string; username: string | null },
  automation: GateAutomation,
  email: string,
) {
  const result = await syncLead(capture.workspaceId, {
    email,
    tagIds: automation.crmTagId ? [automation.crmTagId] : [],
  });
  await prisma.emailCapture.update({
    where: { id: capture.id },
    data: { email, crmSyncedAt: result.ok ? new Date() : null, crmError: result.ok ? null : result.error ?? null },
  });
  return result;
}
