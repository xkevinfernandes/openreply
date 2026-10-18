"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { editContacts, type ContactChange, type EditResult } from "@/lib/os/contacts-edit";

/** Every Contacts write: bulk actions, drag between columns, the side panel. */
export async function updateContacts(ids: string[], change: ContactChange): Promise<EditResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const result = await editContacts(workspaceId, ids, change);
    if (!result.error) {
      revalidatePath("/os/contacts");
      revalidatePath("/os/inbox");
    }
    return result;
  } catch (err) {
    console.error("[OS Contacts] update failed:", err);
    return { error: "That didn't save. Try again." };
  }
}
