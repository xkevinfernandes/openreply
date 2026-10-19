"use server";

// The Inspect drawer ("J's brain") on a draft: read only.

import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadInspect } from "@/lib/os/setter/inspect/load";
import type { InspectView } from "@/lib/os/setter/inspect/view";

export async function inspectDraft(draftId: string): Promise<{ view: InspectView } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  if (typeof draftId !== "string" || !draftId || draftId.length > 100) return { error: "No draft." };
  try {
    const view = await loadInspect(workspaceId, draftId);
    return view ? { view } : { error: "That draft is gone." };
  } catch (err) {
    console.error("[OS Inspect]", err);
    return { error: "Couldn't load the trace. Try again." };
  }
}
