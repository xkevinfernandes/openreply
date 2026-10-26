"use server";

import { workflowKevinSent } from "@/lib/os/workflows/hooks";
import { revalidatePath } from "next/cache";
import { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { holdDraft, loadThreadData, sendReply, type ThreadData } from "@/lib/os/inbox";
import { recordInbound } from "@/lib/os/inbox-crm";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import { dropOnColumn } from "@/lib/os/funnel";
import { writeStage } from "@/lib/os/stage-writer";
import { pendingDrafts } from "@/lib/os/setter/service";
import type { DraftView } from "@/lib/os/setter/store";
import { draftBlockedReason } from "@/components/os/inbox/categories";
import { fireContactEvent } from "@/lib/os/integrations/events";
import type { SyncEvent } from "@/lib/os/integrations/mapping";
import { appendMockIncoming, mockThreads, osMockEnabled, updateMockContact } from "@/lib/os/mock";
import { enqueueTriageMany, redisConfigured, scheduleNextAction } from "@/lib/os/setter/queue";
import { TRIAGE_DISABLED_NOTICE, triageContact, triageDisabled } from "@/lib/os/setter/triage";
import { markAttendance, syncFollowupsQuietly } from "@/lib/os/sequences/engine";
import { approveDraft, draftForContact } from "@/lib/os/setter/service";
import { setterStore } from "@/lib/os/setter/store";
import type { SetterRecord } from "@/lib/os/setter/state";

async function requireWorkspace() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) throw new Error("Sign in again.");
  return workspaceId;
}

type ContactPatch = {
  kind?: ContactKind;
  kindSource?: string;
  suggestedKind?: ContactKind | null;
  suggestedReason?: string | null;
  suggestedConfidence?: number | null;
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
  // Out of Sales = no follow-ups; into Sales = maybe one is due.
  await syncFollowupsQuietly(contactId);
}

export async function setContactStage(contactId: string, stage: ContactStage): Promise<{ error?: string }> {
  if (!Object.values(ContactStage).includes(stage)) throw new Error("Unknown stage.");
  const workspaceId = await requireWorkspace();
  // Kevin's move, through the one stage writer (move table, log, stage-changed hook).
  const r = await writeStage({ workspaceId, contactId, cause: "user", change: { type: "stage", stage } });
  if (r.status === "refused" || r.status === "missing") return { error: r.reason };
  if (r.status === "applied" && !osMockEnabled()) await fireContactEvent({ workspaceId, contactId, event: "stage_changed" });
  // Showed on the board = they came to the call: Kevin's voice-note task.
  if (stage === "SHOWED") await markAttendance(workspaceId, contactId, "SHOWED").catch(() => null);
  revalidatePath("/os/inbox");
  revalidatePath("/os/follow-ups");
  return {};
}

export async function sendInboxMessage(
  igUserId: string,
  text: string | string[],
  where: { conversationId?: string | null; contactId?: string | null } = {}
): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  // One message per bubble, in order (a link is its own bubble).
  const bubbles = (Array.isArray(text) ? text : [text]).map((t) => t.trim()).filter(Boolean);
  if (!bubbles.length) return { error: "Write a message first." };
  try {
    for (const message of bubbles) {
      await sendReply(workspaceId, igUserId, message, { conversationId: where.conversationId ?? null, contactId: where.contactId ?? null, source: "manual", human: true });
    }
    // Kevin wrote by hand: a workflow run (and J) pause for this person (K1).
    await workflowKevinSent(workspaceId, where.contactId, bubbles.join("\n"));
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
  // Re-plan the follow-up after every look: a reply stops a sequence, a send moves it on.
  await syncFollowupsQuietly(contactId);
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
  const contactId = (await setterStore().getDraft(draftId, workspaceId))?.contactId ?? null;
  const result = await approveDraft(draftId, workspaceId, {
    editedText: editedText ?? null,
    onState: (rec) => (rec.contact_id ? scheduleTimer(rec.contact_id, rec) : undefined),
  });
  if (result.rebook && contactId) {
    // The time was taken (or Calendly can't book on this plan): nothing was
    // sent. J offers times again right away; Kevin still approves that one.
    const again = await draftWithJ(contactId);
    revalidatePath("/os/inbox");
    return { error: result.error, notice: again.error ?? again.notice };
  }
  if (contactId) await syncFollowupsQuietly(contactId, { workspaceId });
  revalidatePath("/os/inbox");
  revalidatePath("/os/follow-ups");
  return { error: result.error };
}

/** OS_MOCK only: a message from them, so the booking flow can be clicked
 *  through on sample data (pick a time, give an email, send the screenshot). */
export async function simulateTheirReply(conversationId: string, text: string, screenshot = false): Promise<DraftActionResult> {
  await requireWorkspace();
  if (!osMockEnabled()) return { error: "Only on sample data." };
  const message = screenshot ? "[image attachment]" : text.trim();
  if (!message) return { error: "Write what they say first." };
  appendMockIncoming(conversationId, message, screenshot ? "image" : null);
  // Same inbox write as the webhook: unread, un-archive, spam check.
  const contactId = mockThreads().find((t) => t.conversationId === conversationId)?.contact?.id;
  if (contactId) await recordInbound({ workspaceId: await requireWorkspace(), contactId, text: screenshot ? null : message });
  revalidatePath("/os/inbox");
  return {};
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

// --- Inbox A (S1) -----------------------------------------------------------

/** Hold (H): say nothing for now. Nothing sends; J drafts again when they write. */
export async function holdJDraft(draftId: string, reason?: string | null): Promise<DraftActionResult> {
  const workspaceId = await requireWorkspace();
  const contactId = (await setterStore().getDraft(draftId, workspaceId))?.contactId ?? null;
  const result = await holdDraft(draftId, workspaceId, reason ?? null);
  if (contactId) await syncFollowupsQuietly(contactId, { workspaceId });
  revalidatePath("/os/inbox");
  revalidatePath("/os/follow-ups");
  return result;
}

/** The panel's stage pill (event bus "move-stage"): a funnel column sets J's
 *  stage hint, an outcome column sets the CRM stage. */
export async function moveContactStage(contactId: string, column: string): Promise<{ error?: string }> {
  const workspaceId = await requireWorkspace();
  const panel = await loadContactPanel(workspaceId, contactId);
  if (!panel) return { error: "That contact is gone. Refresh the page." };
  const drop = dropOnColumn(column, panel.stage.columns);
  if ("error" in drop) return { error: drop.error };
  if ("stage" in drop) return setContactStage(contactId, drop.stage);
  const r = await writeStage({ workspaceId, contactId, cause: "user", change: { type: "column", column: column } });
  if (r.status === "refused" || r.status === "missing") return { error: r.reason };
  if (r.status === "applied" && !osMockEnabled()) await fireContactEvent({ workspaceId, contactId, event: "stage_changed" });
  revalidatePath("/os/inbox");
  revalidatePath("/os/contacts");
  return {};
}

/** "Earlier messages": the next older page of the open thread. */
export async function loadEarlierMessages(conversationId: string, contactId: string | null, cursor: string): Promise<ThreadData | { error: string }> {
  const workspaceId = await requireWorkspace();
  try {
    return await loadThreadData(workspaceId, conversationId, contactId, cursor);
  } catch (err) {
    console.error("[OS Inbox] earlier messages failed:", err);
    return { error: "Older messages didn't load. Try again." };
  }
}

export interface ChatTabData {
  contactId: string;
  igUserId: string;
  conversationId: string;
  who: string;
  draft: DraftView | null;
  draftBlockedReason: string | null;
  thread: ThreadData;
}

/** The Contacts panel's Chat tab: the same thread and composer as the Inbox. */
export async function loadChatTab(contactId: string): Promise<ChatTabData | { error: string }> {
  const workspaceId = await requireWorkspace();
  const contact = await setterStore().getContact(contactId, workspaceId);
  if (!contact?.conversationId) return { error: "No conversation yet." };
  try {
    const [thread, drafts] = await Promise.all([
      loadThreadData(workspaceId, contact.conversationId, contactId),
      pendingDrafts(workspaceId).catch(() => [] as DraftView[]),
    ]);
    return {
      contactId,
      igUserId: contact.igUserId,
      conversationId: contact.conversationId,
      who: contact.username ? `@${contact.username}` : (contact.fullName ?? "them"),
      draft: drafts.find((d) => d.contactId === contactId) ?? null,
      draftBlockedReason: draftBlockedReason(contact),
      thread,
    };
  } catch (err) {
    console.error("[OS Inbox] chat tab failed:", err);
    return { error: "Instagram didn't answer. Try again in a minute." };
  }
}
