"use server";

// Broadcasts (one-off): the list and the five-step builder. Nothing here
// sends without approved drafts and Send; each send re-checks the window,
// Pause all and the cap (lib/os/broadcasts/send.ts).

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentWorkspaceId } from "@/lib/auth";
import {
  approveAll,
  approveMessage,
  cancelBroadcast,
  createBroadcast,
  draftForComposer,
  duplicateBroadcast,
  editMessage,
  extendEnd,
  includeAnyway,
  makeDrafts,
  newBroadcastToUnsent,
  redraftOne,
  redraftWroteSince,
  reopenBroadcast,
  saveSteps,
  sendBroadcast,
  skipMessage,
  unapproveMessage,
  type StepsInput,
} from "@/lib/os/broadcasts/engine";
import { sendBroadcastPart } from "@/lib/os/broadcasts/send";
import { broadcastStore } from "@/lib/os/broadcasts/store";
import { createLinkResource } from "@/lib/os/broadcasts/resources";

export interface ActionResult {
  error?: string;
  notice?: string;
  /** Ask first ("This remakes all N drafts…"); call again with confirm. */
  confirm?: string;
  /** Go here next (a new or duplicated broadcast). */
  href?: string;
}

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

function refresh(key?: string) {
  revalidatePath("/os/automations/broadcasts");
  if (key) revalidatePath(`/os/automations/broadcasts/${key}`);
  revalidatePath("/os/follow-ups");
  revalidatePath("/os");
}

async function run(key: string | undefined, fn: (w: string) => Promise<ActionResult>): Promise<ActionResult> {
  try {
    const w = await requireWorkspace();
    return await fn(w);
  } catch (err) {
    console.error("[OS Broadcasts] action failed:", err);
    return { error: err instanceof Error ? err.message : "That didn't work. Try again." };
  } finally {
    refresh(key);
  }
}

const href = (key: string) => `/os/automations/broadcasts/${key}`;

/**
 * Open a new or duplicated broadcast with a server redirect, so the address
 * bar always shows the broadcast on screen (a client push after the action's
 * refresh could leave the old URL). Outside run()'s try: redirect throws.
 */
async function openNext(r: ActionResult): Promise<ActionResult> {
  if (r.href) redirect(r.href);
  return r;
}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function newBroadcastAction(): Promise<ActionResult> {
  return openNext(
    await run(undefined, async (w) => {
      const r = await createBroadcast(w);
      return r.ok ? { href: href(r.key) } : { error: r.error };
    })
  );
}

export async function duplicateAction(key: string): Promise<ActionResult> {
  return openNext(
    await run(key, async (w) => {
      const r = await duplicateBroadcast(w, String(key));
      return r.ok ? { href: href(r.key) } : { error: r.error };
    })
  );
}

/** Save steps. With drafts made, a Who/Messages/Personalise change returns `confirm` first. */
export async function saveStepsAction(key: string, input: StepsInput, confirm = false): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await saveSteps(w, String(key), input, { confirm: Boolean(confirm) });
    if (!r.ok) return r.confirm ? { confirm: r.confirm } : { error: r.error };
    return r.remade ? { notice: "Remaking the drafts." } : {};
  });
}

export async function makeDraftsAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await makeDrafts(w, String(key));
    // The Review step shows the progress ("Drafting 2 of 6") until it's done.
    return r.ok ? {} : { error: r.error };
  });
}

export async function redraftOneAction(key: string, messageId: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await redraftOne(w, String(messageId));
    return r.ok ? {} : { error: r.error };
  });
}

export async function editMessageAction(key: string, messageId: string, input: { text?: string; followup?: string }): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await editMessage(w, String(messageId), { text: typeof input.text === "string" ? input.text : undefined, followup: typeof input.followup === "string" ? input.followup : undefined });
    return r.ok ? {} : { error: r.error };
  });
}

export async function approveMessageAction(key: string, messageId: string, approve: boolean): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = approve ? await approveMessage(w, String(messageId)) : await unapproveMessage(w, String(messageId));
    return r.ok ? {} : { error: r.error };
  });
}

export async function approveAllAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await approveAll(w, String(key));
    return r.ok ? { notice: `${plural(r.approved, "draft")} approved.` } : { error: r.error };
  });
}

export async function skipMessageAction(key: string, messageId: string, skip: boolean): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await skipMessage(w, String(messageId), Boolean(skip));
    return r.ok ? {} : { error: r.error };
  });
}

export async function includeAnywayAction(key: string, messageId: string, on: boolean): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await includeAnyway(w, String(messageId), Boolean(on));
    return r.ok ? {} : { error: r.error };
  });
}

export async function sendAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await sendBroadcast(w, String(key));
    if (!r.ok) return { error: r.error };
    const extra = [
      r.capped ? `${r.capped} over the cap` : null,
      r.outside ? `${r.outside} outside their window` : null,
      r.leftOut ? `${r.leftOut} left out` : null,
      r.taggedSince ? `${r.taggedSince} new in Who since drafting, not included` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const worker = r.queued ? "" : " The send worker isn't running here, so they won't go by themselves.";
    return { notice: `${r.scheduled} scheduled${extra ? ` (${extra})` : ""}.${worker}` };
  });
}

export async function extendEndAction(key: string, to: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await extendEnd(w, String(key), String(to));
    return r.ok ? { notice: `Ends at ${to}.` } : { error: r.error };
  });
}

export async function cancelAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await cancelBroadcast(w, String(key));
    if (!r.ok) return { error: r.error };
    return { notice: r.sent || r.cancelled ? `Cancelled. Sent ${r.sent}, cancelled ${r.cancelled}.` : "Cancelled." };
  });
}

export async function reopenAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await reopenBroadcast(w, String(key));
    return r.ok ? {} : { error: r.error };
  });
}

export async function redraftWroteSinceAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await redraftWroteSince(w, String(key));
    return r.ok ? {} : { error: r.error };
  });
}

export async function newToUnsentAction(key: string): Promise<ActionResult> {
  return openNext(
    await run(key, async (w) => {
      const r = await newBroadcastToUnsent(w, String(key));
      return r.ok ? { href: href(r.key) } : { error: r.error };
    })
  );
}

/** "+ New resource" from the picker: a resource with a link (required). */
export async function newResourceAction(input: { name: string; link: string }): Promise<ActionResult & { resource?: { id: string; name: string; link: string } }> {
  return run(undefined, async (w) => {
    const r = await createLinkResource(w, { name: String(input.name ?? ""), link: String(input.link ?? "") });
    if (!r.ok) return { error: r.error };
    revalidatePath("/os/resources");
    return { resource: r.resource };
  });
}

/** Send myself: the draft for the inbox composer. */
export async function composerDraftAction(messageId: string): Promise<{ bubbles?: string[]; name?: string; error?: string }> {
  try {
    const w = await requireWorkspace();
    const d = await draftForComposer(w, String(messageId));
    return d ?? { error: "That draft is gone or already sent." };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Couldn't load the draft." };
  }
}

// --- Timeline rows (Follow-ups) -------------------------------------------------

async function ownMessage(w: string, messageId: string) {
  const m = await broadcastStore().getMessage(String(messageId));
  return m && m.workspaceId === w ? m : null;
}

/** Send an approved broadcast message now (still inside the checks). */
export async function sendBroadcastNowAction(messageId: string): Promise<ActionResult> {
  return run(undefined, async (w) => {
    if (!(await ownMessage(w, messageId))) return { error: "That message is gone. Refresh." };
    const r = await sendBroadcastPart({ messageId: String(messageId), part: "main" }, { manual: true });
    if (r.status === "sent") return { notice: "Sent." };
    return { error: "reason" in r ? r.reason : "Not sent." };
  });
}

/** Take a scheduled message off the schedule: it's skipped "cancelled". */
export async function unscheduleBroadcastAction(messageId: string): Promise<ActionResult> {
  return run(undefined, async (w) => {
    const m = await ownMessage(w, messageId);
    if (!m || m.status !== "scheduled") return { error: "Nothing to unschedule." };
    await broadcastStore().updateMessage(m.id, { status: "skipped", skipReason: "cancelled", error: "Cancelled" });
    return { notice: "Won't send." };
  });
}

export async function skipBroadcastAction(messageId: string): Promise<ActionResult> {
  return unscheduleBroadcastAction(messageId);
}
