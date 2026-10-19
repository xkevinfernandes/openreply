"use server";

// Broadcasts (Follow-up Friday): the builder and the timeline's row actions.
// Nothing here sends without an approved message; Send now re-checks the
// window, Pause all and the cap (lib/os/broadcasts/send.ts).

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import {
  approveMessage,
  editMessage,
  regenerate,
  saveBroadcast,
  scheduleRun,
  setInAudience,
  setMessageTime,
  skipMessage,
  unapproveMessage,
  type BroadcastInput,
} from "@/lib/os/broadcasts/engine";
import { sendBroadcastPart } from "@/lib/os/broadcasts/send";
import { broadcastStore } from "@/lib/os/broadcasts/store";

export interface ActionResult {
  error?: string;
  notice?: string;
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

const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Save the builder; a pasted link starts this week's run and J drafts. */
export async function saveBroadcastAction(key: string, input: BroadcastInput): Promise<ActionResult> {
  return run(key, async (w) => {
    const clean: BroadcastInput = {
      link: input.link === null ? null : str(input.link),
      template: str(input.template),
      followupOn: typeof input.followupOn === "boolean" ? input.followupOn : undefined,
      followupTemplate: input.followupTemplate === null ? null : str(input.followupTemplate),
      followupDelayMin: input.followupDelayMin !== undefined ? Number(input.followupDelayMin) : undefined,
      windowDay: input.windowDay !== undefined ? Number(input.windowDay) : undefined,
      windowStart: str(input.windowStart),
      windowEnd: str(input.windowEnd),
      enabled: typeof input.enabled === "boolean" ? input.enabled : undefined,
    };
    const r = await saveBroadcast(w, String(key), clean);
    if (!r.ok) return { error: r.error };
    return { notice: r.drafted ? `J drafted ${r.drafted}. Review each one.` : "Saved." };
  });
}

export async function regenerateAction(key: string, messageId: string | null): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await regenerate(w, String(key), messageId ? String(messageId) : null);
    return r.ok ? {} : { error: r.error };
  });
}

export async function editMessageAction(key: string, messageId: string, input: { text?: string; followup?: string }): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await editMessage(w, String(messageId), { text: str(input.text), followup: str(input.followup) });
    return r.ok ? {} : { error: r.error };
  });
}

export async function approveMessageAction(key: string, messageId: string, approve: boolean): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = approve ? await approveMessage(w, String(messageId)) : await unapproveMessage(w, String(messageId));
    return r.ok ? {} : { error: r.error };
  });
}

export async function skipMessageAction(key: string, messageId: string, skip: boolean): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await skipMessage(w, String(messageId), Boolean(skip));
    return r.ok ? {} : { error: r.error };
  });
}

export async function setTimeAction(key: string, messageId: string, hhmm: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await setMessageTime(w, String(messageId), String(hhmm));
    return r.ok ? {} : { error: r.error };
  });
}

export async function scheduleAction(key: string): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await scheduleRun(w, String(key));
    if (!r.ok) return { error: r.error };
    const extra = [r.capped ? `${r.capped} over the cap` : null, r.outside ? `${r.outside} outside the window` : null].filter(Boolean).join(", ");
    const worker = r.queued ? "" : " The send worker isn't running here, so they won't go by themselves.";
    return { notice: `${r.scheduled} scheduled${extra ? ` (${extra})` : ""}.${worker}` };
  });
}

export async function audienceAction(key: string, contactId: string, on: boolean): Promise<ActionResult> {
  return run(key, async (w) => {
    const r = await setInAudience(w, String(key), String(contactId), Boolean(on));
    return r.ok ? {} : { error: r.error };
  });
}

// --- Timeline rows ------------------------------------------------------------

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

/** Take a scheduled message off the schedule (back to a draft to approve). */
export async function unscheduleBroadcastAction(messageId: string): Promise<ActionResult> {
  return run(undefined, async (w) => {
    const r = await unapproveMessage(w, String(messageId));
    return r.ok ? { notice: "Back to a draft." } : { error: r.error };
  });
}

export async function skipBroadcastAction(messageId: string): Promise<ActionResult> {
  return run(undefined, async (w) => {
    const r = await skipMessage(w, String(messageId), true);
    return r.ok ? { notice: "Left out." } : { error: r.error };
  });
}
