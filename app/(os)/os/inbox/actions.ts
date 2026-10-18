"use server";

import { revalidatePath } from "next/cache";
import { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { sendReply } from "@/lib/os/inbox";
import { osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { scheduleNextAction } from "@/lib/os/setter/queue";
import { approveDraft, discardDraft, draftForContact } from "@/lib/os/setter/service";
import type { SetterRecord } from "@/lib/os/setter/state";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

async function updateContact(contactId: string, data: { kind?: ContactKind; kindSource?: string; stage?: ContactStage }) {
  const workspaceId = await requireWorkspace();
  if (osMockEnabled()) {
    updateMockContact(contactId, data);
    revalidatePath("/os/inbox");
    return;
  }
  // updateMany scopes the write to this workspace, so a foreign id is a no-op.
  await prisma.contact.updateMany({ where: { id: contactId, workspaceId }, data });
  revalidatePath("/os/inbox");
}

export async function setContactKind(contactId: string, kind: ContactKind) {
  if (!Object.values(ContactKind).includes(kind)) throw new Error("Unknown kind.");
  await updateContact(contactId, { kind, kindSource: "user" });
}

export async function setContactStage(contactId: string, stage: ContactStage) {
  if (!Object.values(ContactStage).includes(stage)) throw new Error("Unknown stage.");
  await updateContact(contactId, { stage });
}

export async function sendInboxMessage(igUserId: string, text: string): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  const message = text.trim();
  if (!message) return { error: "Write a message first." };
  try {
    await sendReply(workspaceId, igUserId, message);
  } catch (err) {
    // The common failure is Meta's 24-hour window closing; show its message.
    return { error: err instanceof Error ? err.message : "The message didn't send. Try again." };
  }
  revalidatePath("/os/inbox");
  return {};
}

// --- J (the setter) -------------------------------------------------------

export interface DraftActionResult {
  error?: string;
  /** Shown when J chose not to write anything (holding is valid) or nothing was due. */
  notice?: string;
}

async function scheduleTimer(contactId: string, rec: SetterRecord) {
  try {
    await scheduleNextAction(contactId, rec);
  } catch (err) {
    console.error("[OS Setter] could not schedule the next timer:", err instanceof Error ? err.message : err);
  }
}

/** "Draft with J" (and Regenerate): a person asked, so J drafts even when no timer is due. */
export async function draftWithJ(contactId: string): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  try {
    const result = await draftForContact(contactId, {
      force: true,
      workspaceId,
      onState: (rec) => scheduleTimer(contactId, rec),
    });
    revalidatePath("/os/inbox");
    if (result.status === "drafted" || result.status === "existing") return {};
    if (result.status === "held") return { notice: `J would hold here: ${result.reason}` };
    return { notice: result.reason };
  } catch (err) {
    console.error("[OS Setter] draft failed:", err);
    return { error: err instanceof Error ? `J couldn't draft: ${err.message}` : "J couldn't draft. Try again." };
  }
}

export async function approveJDraft(draftId: string, editedText?: string | null): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await approveDraft(draftId, workspaceId, {
    editedText: editedText ?? null,
    onState: (rec) => (rec.contact_id ? scheduleTimer(rec.contact_id, rec) : undefined),
  });
  revalidatePath("/os/inbox");
  return result;
}

export async function discardJDraft(draftId: string): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await discardDraft(draftId, workspaceId);
  revalidatePath("/os/inbox");
  return result;
}
