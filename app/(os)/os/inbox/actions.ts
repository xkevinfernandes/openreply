"use server";

import { revalidatePath } from "next/cache";
import { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { sendReply } from "@/lib/os/inbox";
import { fireContactEvent } from "@/lib/os/integrations/events";
import type { SyncEvent } from "@/lib/os/integrations/mapping";
import { mockThreads, osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { enqueueTriageMany, redisConfigured, scheduleNextAction } from "@/lib/os/setter/queue";
import { TRIAGE_DISABLED_NOTICE, triageContact, triageDisabled } from "@/lib/os/setter/triage";
import { approveDraft, discardDraft, draftForContact } from "@/lib/os/setter/service";
import type { SetterRecord } from "@/lib/os/setter/state";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

type ContactPatch = {
  kind?: ContactKind;
  kindSource?: string;
  stage?: ContactStage;
  suggestedKind?: ContactKind | null;
  suggestedReason?: string | null;
  suggestedConfidence?: number | null;
  tags?: string[];
};

async function updateContact(contactId: string, data: ContactPatch, event?: SyncEvent) {
  const workspaceId = await requireWorkspace();
  if (osMockEnabled()) {
    updateMockContact(contactId, data);
    revalidatePath("/os/inbox");
    return;
  }
  // updateMany scopes the write to this workspace, so a foreign id is a no-op.
  const { count } = await prisma.contact.updateMany({ where: { id: contactId, workspaceId }, data });
  // Push to the connected CRMs (lib/os/integrations). Never throws.
  if (count && event) await fireContactEvent({ workspaceId, contactId, event });
  revalidatePath("/os/inbox");
}

export async function setContactKind(contactId: string, kind: ContactKind) {
  if (!Object.values(ContactKind).includes(kind)) throw new Error("Unknown kind.");
  // The user decided: J's suggestion (or "move to Sales?" flag) is done.
  await updateContact(contactId, { kind, kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null }, "kind_changed");
}

export async function setContactStage(contactId: string, stage: ContactStage) {
  if (!Object.values(ContactStage).includes(stage)) throw new Error("Unknown stage.");
  await updateContact(contactId, { stage }, "stage_changed");
}

/** Replace a contact's tags (trimmed, deduped). Pushed to the CRMs. */
export async function setContactTags(contactId: string, tags: string[]) {
  const clean = [...new Set(tags.map((t) => String(t).trim().slice(0, 60)).filter(Boolean))].slice(0, 50);
  await updateContact(contactId, { tags: clean }, "tags_changed");
}

export async function sendInboxMessage(igUserId: string, text: string): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  const message = text.trim();
  if (!message) return { error: "Write a message first." };
  try {
    await sendReply(workspaceId, igUserId, message);
  } catch (err) {
    // The common failure is Meta's 24-hour window closing; show its message.
    return { error: err instanceof Error ? err.message : "The message didn't send. Try again." };
  }
  revalidatePath("/os/inbox");
  return {};
}

// --- J (the setter) -------------------------------------------------------

export interface DraftActionResult {
  error?: string;
  /** Shown when J chose not to write anything (holding is valid) or nothing was due. */
  notice?: string;
}

async function scheduleTimer(contactId: string, rec: SetterRecord) {
  try {
    await scheduleNextAction(contactId, rec);
  } catch (err) {
    console.error("[OS Setter] could not schedule the next timer:", err instanceof Error ? err.message : err);
  }
}

/** "Draft with J" (and Regenerate): a person asked, so J drafts even when no timer is due. */
export async function draftWithJ(contactId: string): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  try {
    const result = await draftForContact(contactId, {
      force: true,
      workspaceId,
      onState: (rec) => scheduleTimer(contactId, rec),
    });
    revalidatePath("/os/inbox");
    if (result.status === "drafted" || result.status === "existing") return {};
    if (result.status === "held") return { notice: `J would hold here: ${result.reason}` };
    return { notice: result.reason };
  } catch (err) {
    console.error("[OS Setter] draft failed:", err);
    return { error: err instanceof Error ? `J couldn't draft: ${err.message}` : "J couldn't draft. Try again." };
  }
}

export async function approveJDraft(draftId: string, editedText?: string | null): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await approveDraft(draftId, workspaceId, {
    editedText: editedText ?? null,
    onState: (rec) => (rec.contact_id ? scheduleTimer(rec.contact_id, rec) : undefined),
  });
  revalidatePath("/os/inbox");
  return result;
}

export async function discardJDraft(draftId: string): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const result = await discardDraft(draftId, workspaceId);
  revalidatePath("/os/inbox");
  return result;
}

// --- Triage (spec item 7) --------------------------------------------------

export interface TriageActionResult {
  error?: string;
  notice?: string;
}

/** One tap on J's suggestion: take it. */
export async function confirmSuggestion(contactId: string): Promise<TriageActionResult> {
  const workspaceId = await requireWorkspace();
  const suggested = osMockEnabled()
    ? (mockThreads().find((t) => t.contact?.id === contactId)?.contact?.suggestedKind ?? null)
    : ((await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { suggestedKind: true } }))?.suggestedKind ?? null);
  if (!suggested) return { error: "J has no suggestion for this one any more. Refresh the page." };
  await setContactKind(contactId, suggested);
  return {};
}

/** "Keep personal": drop J's "move to Sales?" flag. */
export async function dismissSuggestion(contactId: string): Promise<TriageActionResult> {
  await updateContact(contactId, { suggestedKind: null, suggestedReason: null, suggestedConfidence: null });
  return {};
}

/** Take every suggestion J made on the Unsorted tab. */
export async function confirmAllSuggestions(): Promise<TriageActionResult> {
  const workspaceId = await requireWorkspace();
  let n = 0;
  if (osMockEnabled()) {
    for (const t of mockThreads()) {
      if (t.contact?.kind !== "UNSORTED" || !t.contact.suggestedKind) continue;
      updateMockContact(t.contact.id, { kind: t.contact.suggestedKind, kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null });
      n++;
    }
  } else {
    const toSort = await prisma.contact.findMany({
      where: { workspaceId, kind: "UNSORTED", suggestedKind: { in: ["SALES", "PERSONAL"] } },
      select: { id: true },
    });
    const rows = await prisma.$transaction(
      (["SALES", "PERSONAL"] as const).map((kind) =>
        prisma.contact.updateMany({
          where: { workspaceId, kind: "UNSORTED", suggestedKind: kind },
          data: { kind, kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null },
        })
      )
    );
    n = rows.reduce((sum, r) => sum + r.count, 0);
    for (const c of toSort) await fireContactEvent({ workspaceId, contactId: c.id, event: "kind_changed" });
  }
  revalidatePath("/os/inbox");
  return { notice: n ? `Sorted ${n} ${n === 1 ? "conversation" : "conversations"}.` : "Nothing to confirm yet." };
}

/** Without a worker (local dev, OS_MOCK) "Sort with J" runs this many inline. */
const INLINE_TRIAGE_CAP = 10;

/** "Sort with J": queue a look at every Unsorted contact. J skips the ones it
 *  already judged on their latest message. */
export async function sortWithJ(): Promise<TriageActionResult> {
  const workspaceId = await requireWorkspace();
  // Production without Jev or a model: say so, never write fake guesses.
  if (triageDisabled()) return { notice: `${TRIAGE_DISABLED_NOTICE}.` };
  const ids = osMockEnabled()
    ? mockThreads()
        .filter((t) => t.contact?.kind === "UNSORTED")
        .map((t) => t.contact!.id)
    : (
        await prisma.contact.findMany({
          where: { workspaceId, kind: "UNSORTED", zernioConversationId: { not: null } },
          select: { id: true },
          orderBy: { lastMessageAt: "desc" },
        })
      ).map((c) => c.id);
  if (!ids.length) return { notice: "Nothing to sort." };

  if (redisConfigured() && !osMockEnabled()) {
    const n = await enqueueTriageMany(ids, "manual");
    const minutes = Math.ceil(n / 10);
    return { notice: `J is sorting ${n} ${n === 1 ? "conversation" : "conversations"}${minutes > 1 ? `, about ${minutes} minutes` : ""}. Suggestions show up here.` };
  }

  let suggested = 0;
  let unsure = 0;
  let looked = 0;
  let left = 0;
  try {
    for (const id of ids) {
      if (looked >= INLINE_TRIAGE_CAP) {
        left++;
        continue;
      }
      const r = await triageContact(id, { workspaceId, manual: true });
      if (r.status !== "skipped") looked++;
      if (r.status === "suggested") suggested++;
      if (r.status === "unsure") unsure++;
    }
  } catch (err) {
    console.error("[OS Setter] triage failed:", err);
    revalidatePath("/os/inbox");
    return { error: err instanceof Error ? `J couldn't sort: ${err.message}` : "J couldn't sort. Try again." };
  }
  revalidatePath("/os/inbox");
  const more = left ? ` ${left} still to look at: tap Sort with J again.` : "";
  const notSure = unsure ? ` J isn't sure about ${unsure}.` : "";
  return { notice: `${suggested} new ${suggested === 1 ? "suggestion" : "suggestions"}.${notSure}${more}` };
}
