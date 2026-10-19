"use server";

// Shell actions (sidebar foot). Pause all is the kill switch: every send path
// checks it (lib/os/sending/cap.ts) and draft jobs wait while it is on.

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { setPausedAll } from "@/lib/os/workspace-settings";

export async function setPauseAll(paused: boolean): Promise<{ pausedAll: boolean } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const s = await setPausedAll(workspaceId, paused === true);
    revalidatePath("/os", "layout");
    return { pausedAll: s.pausedAll };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't change Pause all." };
  }
}
