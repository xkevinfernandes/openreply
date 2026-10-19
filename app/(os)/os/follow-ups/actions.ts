"use server";

import { revalidatePath } from "next/cache";
import type { DraftActionResult } from "@/app/(os)/os/inbox/actions";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { markAttendance, sendStepNow, setTaskDone, setThreadFollowups, skipStep, type EngineResult } from "@/lib/os/sequences/engine";
import { setFriday } from "@/lib/os/followups-data";
import { broadcastStore } from "@/lib/os/broadcasts/store";
import { FOLLOW_UP_FRIDAY } from "@/lib/os/broadcasts/types";
import { loadContactFollowups, type ContactFollowupsData } from "@/lib/os/contact-panel/followups";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

function refresh() {
  revalidatePath("/os/follow-ups");
  revalidatePath("/os");
}

// --- Follow-up Friday --------------------------------------------------------

/** On / off the Follow-up Friday list: the follow-up-friday tag the broadcast reads (and the legacy flag). */
export async function setOnFriday(contactId: string, on: boolean): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  if (typeof on !== "boolean") return { error: "Friday needs on or off." };
  await setFriday(workspaceId, [contactId], on);
  await broadcastStore().setTag(workspaceId, String(contactId), FOLLOW_UP_FRIDAY.tag, on);
  refresh();
  revalidatePath("/os/inbox");
  revalidatePath("/os/contacts");
  return {};
}

// --- Follow-up sequences (lib/os/sequences) ----------------------------------

function refreshAll() {
  refresh();
  revalidatePath("/os/inbox");
  revalidatePath("/os/contacts");
}

async function guarded(fn: (workspaceId: string) => Promise<EngineResult>): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  try {
    return await fn(workspaceId);
  } catch (err) {
    console.error("[OS Follow-ups] action failed:", err);
    return { error: err instanceof Error ? err.message : "That didn't work. Try again." };
  } finally {
    refreshAll();
  }
}

/** Send now: a drafted step goes out; a queued fixed line goes out; J's own words come back as a draft to approve. */
export async function sendFollowupNow(stepId: string): Promise<DraftActionResult> {
  return guarded((w) => sendStepNow(w, String(stepId)));
}

export async function skipFollowup(stepId: string): Promise<DraftActionResult> {
  return guarded((w) => skipStep(w, String(stepId)));
}

/** Per-thread Follow-ups on / off. */
export async function setFollowupsOn(contactId: string, on: boolean): Promise<DraftActionResult> {
  if (typeof on !== "boolean") return { error: "On or off?" };
  return guarded((w) => setThreadFollowups(w, String(contactId), on));
}

/** Showed / No-show / clear, by hand. */
export async function markCall(contactId: string, attendance: "SHOWED" | "NO_SHOW" | null): Promise<DraftActionResult> {
  if (attendance !== null && attendance !== "SHOWED" && attendance !== "NO_SHOW") return { error: "Showed or no-show?" };
  return guarded(async (w) => {
    const r = await markAttendance(w, String(contactId), attendance, "user");
    if (r.error) return r;
    return {
      notice:
        attendance === "SHOWED"
          ? "Marked as showed. Your voice-note task is on Home."
          : attendance === "NO_SHOW"
            ? "Marked as no-show. J starts a warm check-in; nothing goes without your approve."
            : "Cleared.",
    };
  });
}

export async function completeTask(taskId: string, done = true): Promise<DraftActionResult> {
  return guarded((w) => setTaskDone(w, String(taskId), done));
}

// --- Contact panel: Follow-ups tab ---------------------------------------------

export async function loadPanelFollowups(contactId: string): Promise<ContactFollowupsData | { error: string }> {
  try {
    const workspaceId = await requireWorkspace();
    return await loadContactFollowups(workspaceId, String(contactId));
  } catch (err) {
    console.error("[OS Follow-ups] panel load failed:", err);
    return { error: "Follow-ups didn't load." };
  }
}
