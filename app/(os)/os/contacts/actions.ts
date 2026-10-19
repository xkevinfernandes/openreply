"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadContactDetails, type ContactDetailsData } from "@/lib/os/contact-panel/details";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { loadContactActivity, type ActivityItem } from "@/lib/os/contacts-activity";
import { editContacts, type ContactChange, type EditResult } from "@/lib/os/contacts-edit";
import { setContactFieldValue } from "@/lib/os/fields/store";
import { fireContactEvent } from "@/lib/os/integrations/events";
import { osMockEnabled } from "@/lib/os/mock";
import { markAttendance, syncFollowupsQuietly } from "@/lib/os/sequences/engine";

/** Follow-ups follow the change: paused / out of Sales stops them, Showed
 *  means they came to the call (Kevin's voice-note task). */
async function followupsAfter(workspaceId: string, ids: string[], change: ContactChange) {
  if (!["kind", "paused", "stage", "setterStage", "addTag", "removeTag"].includes(change.type)) return;
  for (const id of ids.slice(0, 100)) {
    if (change.type === "stage" && change.stage === "SHOWED") await markAttendance(workspaceId, id, "SHOWED").catch(() => null);
    else await syncFollowupsQuietly(id, { workspaceId });
  }
}

/** Every Contacts write: bulk actions, drag between columns, the panel. */
export async function updateContacts(ids: string[], change: ContactChange): Promise<EditResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const result = await editContacts(workspaceId, ids, change);
    if (!result.error) {
      await followupsAfter(workspaceId, Array.isArray(ids) ? ids : [], change);
      revalidatePath("/os/contacts");
      revalidatePath("/os/inbox");
      revalidatePath("/os/follow-ups");
    }
    return result;
  } catch (err) {
    console.error("[OS Contacts] update failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

/** The push panel for one contact (head + Details), loaded on click. */
export async function loadPanel(contactId: string): Promise<{ panel: ContactPanelData; details: ContactDetailsData } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const [panel, details] = await Promise.all([loadContactPanel(workspaceId, contactId), loadContactDetails(workspaceId, contactId)]);
    return panel ? { panel, details } : { error: "That contact is gone." };
  } catch (err) {
    console.error("[OS Contacts] panel failed:", err);
    return { error: "The panel didn't load." };
  }
}

/** Details tab body, for hosts that only have the panel head (the Inbox). */
export async function loadDetails(contactId: string): Promise<ContactDetailsData | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    return await loadContactDetails(workspaceId, contactId);
  } catch (err) {
    console.error("[OS Contacts] details failed:", err);
    return { error: "Details didn't load." };
  }
}

export async function loadActivity(contactId: string): Promise<ActivityItem[] | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    return await loadContactActivity(workspaceId, contactId);
  } catch (err) {
    console.error("[OS Contacts] activity failed:", err);
    return { error: "Activity didn't load." };
  }
}

/** Inline edit in the Details tab. Saved as Kevin's value; J won't overwrite it. */
export async function saveFieldValue(contactId: string, fieldKey: string, value: string | null): Promise<{ value: string | null } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const r = await setContactFieldValue(workspaceId, contactId, fieldKey, value);
    if (!("error" in r)) revalidatePath("/os/contacts");
    return r;
  } catch (err) {
    console.error("[OS Contacts] field save failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

/** "Sync now" on the Details tab: push the contact to every connected CRM. */
export async function syncContactNow(contactId: string): Promise<{ ok: true } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  if (osMockEnabled()) return { ok: true };
  await fireContactEvent({ workspaceId, contactId, event: "manual" });
  return { ok: true };
}
