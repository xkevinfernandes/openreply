"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { editContacts, type ContactChange, type EditResult } from "@/lib/os/contacts-edit";
import { markAttendance, syncFollowupsQuietly } from "@/lib/os/sequences/engine";

/** Follow-ups follow the change: paused / out of Sales stops them, Showed
 *  means they came to the call (Kevin's voice-note task). */
async function followupsAfter(workspaceId: string, ids: string[], change: ContactChange) {
  if (!["kind", "paused", "stage", "addTag", "removeTag"].includes(change.type)) return;
  for (const id of ids.slice(0, 100)) {
    if (change.type === "stage" && change.stage === "SHOWED") await markAttendance(workspaceId, id, "SHOWED").catch(() => null);
    else await syncFollowupsQuietly(id, { workspaceId });
  }
}

/** Every Contacts write: bulk actions, drag between columns, the side panel. */
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
