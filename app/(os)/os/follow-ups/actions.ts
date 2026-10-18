"use server";

import { revalidatePath } from "next/cache";
import { approveJDraft, discardJDraft, draftWithJ, type DraftActionResult } from "@/app/(os)/os/inbox/actions";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { setterStore } from "@/lib/os/setter/store";
import { sendFridayResource, setFriday, skipTimer, snoozeContact, type FridaySendInput, type FridaySendResult } from "@/lib/os/followups-data";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

function refresh() {
  revalidatePath("/os/follow-ups");
  revalidatePath("/os");
}

// --- J's nudges: the same approve path as the Inbox ------------------------

export async function approveNudge(draftId: string): Promise<DraftActionResult> {
  const r = await approveJDraft(draftId);
  refresh();
  return r;
}

/** Skip: discard the draft, or (no draft yet) tell J to let this timer go. */
export async function skipNudge(contactId: string, draftId: string | null, anchor: string | null): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const r = draftId ? await discardJDraft(draftId) : anchor ? await skipTimer(workspaceId, contactId, anchor) : { error: "Nothing to skip." };
  refresh();
  return r;
}

export async function snoozeNudge(contactId: string, hours: number): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const r = await snoozeContact(workspaceId, contactId, hours);
  refresh();
  return r;
}

export async function draftNudge(contactId: string): Promise<DraftActionResult> {
  const r = await draftWithJ(contactId);
  refresh();
  if (r.error || r.notice) return r;
  // J reads the whole thread: when they wrote last, it answers instead of nudging.
  const d = await setterStore().pendingDraft(contactId).catch(() => null);
  if (d && d.kind !== "nudge" && d.kind !== "value_opener") return { notice: "They wrote last, so J drafted a reply instead. It's waiting in the Inbox." };
  return r;
}

// --- Follow-up Friday --------------------------------------------------------

export async function setOnFriday(contactId: string, on: boolean): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  if (typeof on !== "boolean") return { error: "Friday needs on or off." };
  await setFriday(workspaceId, [contactId], on);
  refresh();
  revalidatePath("/os/inbox");
  revalidatePath("/os/contacts");
  return {};
}

function cleanInput(i: FridaySendInput): FridaySendInput | null {
  if (!i || typeof i.contactId !== "string" || typeof i.resourceId !== "string") return null;
  return { contactId: i.contactId, resourceId: i.resourceId, note: typeof i.note === "string" ? i.note : null };
}

/** One person, one click. */
export async function sendFriday(input: FridaySendInput): Promise<FridaySendResult> {
  const workspaceId = await requireWorkspace();
  const clean = cleanInput(input);
  if (!clean) return { contactId: String(input?.contactId ?? ""), error: "Pick a resource first." };
  try {
    return await sendFridayResource(workspaceId, clean);
  } catch (err) {
    console.error("[OS Follow-ups] friday send failed:", err);
    return { contactId: clean.contactId, error: err instanceof Error ? err.message : "That didn't send. Try again." };
  } finally {
    refresh();
  }
}

/** The batch the user confirmed. One at a time, so a failure stops nobody else. */
export async function sendFridayBatch(inputs: FridaySendInput[]): Promise<FridaySendResult[]> {
  const workspaceId = await requireWorkspace();
  const list = (Array.isArray(inputs) ? inputs : []).slice(0, 100);
  const out: FridaySendResult[] = [];
  for (const raw of list) {
    const clean = cleanInput(raw);
    if (!clean) continue;
    try {
      out.push(await sendFridayResource(workspaceId, clean));
    } catch (err) {
      console.error("[OS Follow-ups] friday send failed:", err);
      out.push({ contactId: clean.contactId, error: err instanceof Error ? err.message : "That didn't send." });
    }
  }
  refresh();
  return out;
}
