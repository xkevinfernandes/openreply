"use server";

import { revalidatePath } from "next/cache";
import { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { sendReply } from "@/lib/os/inbox";
import { osMockEnabled, updateMockContact } from "@/lib/os/mock";

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
