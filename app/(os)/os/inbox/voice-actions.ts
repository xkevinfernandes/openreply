"use server";

// The composer's mic button: Kevin sends a clip from the setter's list or a
// one-off recording (his post-call notes). His own sends are direct; J's
// drafts still only send on Approve.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getSetterConfig } from "@/lib/os/setter/config";
import { windowState } from "@/lib/os/setter/state";
import { setterStore } from "@/lib/os/setter/store";
import { sendManualVoice } from "@/lib/os/voice/store";

export async function sendVoiceNote(
  contactId: string,
  input: { clipId?: string | null; audioId?: string | null; transcript?: string | null }
): Promise<{ error?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  const store = setterStore();
  const contact = await store.getContact(contactId, workspaceId);
  if (!contact) return { error: "Contact not found." };
  if (!contact.conversationId) return { error: "Open the conversation once so we know where to send it." };
  try {
    // Outside 24h Instagram only takes a live person's reply (HUMAN_AGENT),
    // which this is; past 7 days nothing goes.
    const state = await store.loadState(contact.id).catch(() => null);
    const [win] = state?.their_last_at ? windowState(state.their_last_at, new Date(), getSetterConfig()) : ["open" as const];
    if (win === "closed") return { error: "Instagram's reply window has closed for this person (7 days since their last message)." };
    await sendManualVoice({
      workspaceId,
      contact: { id: contact.id, workspaceId, igUserId: contact.igUserId, conversationId: contact.conversationId },
      clipId: input.clipId ?? null,
      audioId: input.audioId ?? null,
      transcript: input.transcript ?? null,
      humanAgent: win === "human_agent",
    });
  } catch (err) {
    console.error("[OS Voice] send failed:", err);
    return { error: err instanceof Error ? err.message : "The voice note didn't send. Try again." };
  }
  revalidatePath("/os/inbox");
  return {};
}
