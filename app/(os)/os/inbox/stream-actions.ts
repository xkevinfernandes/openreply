"use server";

// The inbox stream's actions (dm-crm issues 009, 011, 012, 014): Mark unread,
// star, archive / restore, Kevin's sticky spam override, and the bulk bar
// (tag, Won / Lost, archive, spam). Tags go through the one tag writer and
// stages through the one stage writer (lib/os/contacts-edit.ts editContacts).

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { editContacts } from "@/lib/os/contacts-edit";
import { markUnread, setArchived, setSpamOverride, setStarred } from "@/lib/os/inbox-crm";
import { syncFollowupsQuietly } from "@/lib/os/sequences/engine";
import { listTags } from "@/lib/os/tags/store";

export interface StreamActionResult {
  error?: string;
  notice?: string;
}

async function run(fn: (workspaceId: string) => Promise<StreamActionResult | void>): Promise<StreamActionResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const r = (await fn(workspaceId)) ?? {};
    revalidatePath("/os/inbox");
    return r;
  } catch (err) {
    console.error("[OS Inbox] stream action failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export async function markThreadsUnread(contactIds: string[]) {
  return run(async (ws) => void (await markUnread(ws, contactIds)));
}

export async function starThreads(contactIds: string[], starred: boolean) {
  return run(async (ws) => void (await setStarred(ws, contactIds, starred)));
}

export async function archiveThreads(contactIds: string[], archived: boolean) {
  return run(async (ws) => {
    const n = await setArchived(ws, contactIds, archived);
    revalidatePath("/os/contacts");
    return { notice: archived ? `Archived ${plural(n, "thread")}.` : `Restored ${plural(n, "thread")}.` };
  });
}

/** "Mark spam" (true) / "Not spam" (false): sticky. */
export async function markThreadsSpam(contactIds: string[], spam: boolean) {
  return run(async (ws) => {
    const n = await setSpamOverride(ws, contactIds, spam);
    return { notice: spam ? `${plural(n, "thread")} moved to Spam.` : `${plural(n, "thread")} back in the inbox.` };
  });
}

/** Bulk tag through the tag writer. */
export async function tagThreads(contactIds: string[], tag: string, op: "add" | "remove") {
  return run(async (ws) => {
    const r = await editContacts(ws, contactIds, op === "add" ? { type: "addTag", tag } : { type: "removeTag", tag });
    if (r.error !== undefined) return { error: r.error };
    revalidatePath("/os/contacts");
    for (const id of contactIds.slice(0, 100)) await syncFollowupsQuietly(id, { workspaceId: ws });
    return { notice: `${op === "add" ? "Tagged" : "Untagged"} ${plural(r.count, "contact")}.` };
  });
}

/**
 * Bulk Won or Lost through the stage writer (move table, stage log, the
 * stage-changed hook that records the won event). Bulk Won records no amount:
 * the Won picker (Contacts stream) fills it in later, and the funnel lists
 * them under "won with no amount".
 */
export async function moveThreadsStage(contactIds: string[], stage: "WON" | "LOST") {
  return run(async (ws) => {
    if (stage !== "WON" && stage !== "LOST") return { error: "Only Won or Lost in bulk." };
    const r = await editContacts(ws, contactIds, { type: "stage", stage });
    if (r.error !== undefined) return { error: r.error };
    revalidatePath("/os/contacts");
    revalidatePath("/os/pipeline");
    revalidatePath("/os/follow-ups");
    for (const id of contactIds.slice(0, 100)) await syncFollowupsQuietly(id, { workspaceId: ws });
    const skipped = contactIds.length - r.count;
    return { notice: `${plural(r.count, "contact")} moved to ${stage === "WON" ? "Won" : "Lost"}.${skipped > 0 ? ` ${skipped} unchanged.` : ""}` };
  });
}

/** The managed tags for the bulk bar's picker. */
export async function inboxTagOptions(): Promise<{ name: string; color: string }[]> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return [];
  try {
    return (await listTags(workspaceId)).map((t) => ({ name: t.name, color: t.color }));
  } catch {
    return [];
  }
}
