// Pure labels for the Workflows list and builder header: is it live, which
// mode it's in (display names only; stored values stay "draft" / "auto"),
// the save state, and the note shown when a server action can't be reached.

import type { WorkflowMode } from "@/components/os/workflows/types";

export type WorkflowStatus = "live" | "off" | "unpublished";

/** Live = published and on; Off = published but switched off; Not published = never published. */
export function workflowStatus(w: { version: number | null; on: boolean }): WorkflowStatus {
  if (!w.version) return "unpublished";
  return w.on ? "live" : "off";
}

export const STATUS_LABEL: Record<WorkflowStatus, string> = {
  live: "Live",
  off: "Off",
  unpublished: "Not published",
};

export const STATUS_TIP: Record<WorkflowStatus, string> = {
  live: "Published and on: new people enter",
  off: "Published but switched off: no new runs",
  unpublished: "Never published: nobody enters until you publish",
};

/** Long labels (builder, tooltips). */
export const MODE_LABEL: Record<WorkflowMode, string> = {
  draft: "Approve each DM",
  auto: "Auto-send",
};

/** Short labels (list pill), always with MODE_TIP as the tooltip. */
export const MODE_SHORT: Record<WorkflowMode, string> = {
  draft: "Approve",
  auto: "Auto",
};

export const MODE_TIP: Record<WorkflowMode, string> = {
  draft: "Approve each DM: J's messages wait for your approval in the Inbox",
  auto: "Auto-send: J's messages send on their own",
};

/** "Has unpublished changes": only meaningful once there's a published version. */
export function hasUnpublishedChanges(w: { version: number | null; unpublished: boolean }): boolean {
  return Boolean(w.version) && w.unpublished;
}

/** Builder header save text. */
export function saveLabel(save: "saved" | "saving" | "error", unpublished: boolean, version: number | null): string {
  if (save === "saving") return "Saving…";
  if (save === "error") return "Not saved";
  if (unpublished) return version ? "Unpublished changes" : "Saved";
  return version ? `v${version}` : "Saved";
}

export const UNREACHABLE_NOTE = "Couldn't reach the app, it may have been updated. Refresh the page (⌘⇧R) and try again.";
export const PUBLISH_FIRST_NOTE = "Publish it first";

/** Next.js control-flow errors (redirect, notFound) must keep propagating. */
function isFrameworkError(err: unknown): boolean {
  const digest = (err as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT") || digest.startsWith("NEXT_HTTP_ERROR_FALLBACK") || digest === "NEXT_NOT_FOUND");
}

/**
 * Call a server action; a throw (e.g. "Failed to find Server Action" after a
 * deploy, or the network) comes back as {error: UNREACHABLE_NOTE} instead of
 * vanishing inside a transition.
 */
export async function callAction<T>(fn: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await fn();
  } catch (err) {
    if (isFrameworkError(err)) throw err;
    console.error("[OS Workflows] server action failed:", err);
    return { error: UNREACHABLE_NOTE };
  }
}

/** Switching On needs a published version; null = allowed to try. */
export function onBlockedNote(next: boolean, version: number | null): string | null {
  return next && !version ? PUBLISH_FIRST_NOTE : null;
}

/** The inline Delete confirm: who stops if it goes. */
export function deleteConfirmText(name: string, live: number): string {
  const n = Math.max(0, live);
  const who = n === 0 ? "Nobody is in it right now." : n === 1 ? "1 person is in it right now; they stop where they are." : `${n} people are in it right now; they stop where they are.`;
  return `Delete ${name.trim() || "this workflow"}? ${who}`;
}
