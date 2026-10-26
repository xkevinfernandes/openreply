"use server";

import { revalidatePath } from "next/cache";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { loadContactDetails, type ContactDetailsData } from "@/lib/os/contact-panel/details";
import { loadContactPanel } from "@/lib/os/contact-panel/load";
import type { ContactPanelData } from "@/lib/os/contact-panel/types";
import { loadContactActivity, type ActivityItem } from "@/lib/os/contacts-activity";
import { editContacts, type ContactChange, type EditResult } from "@/lib/os/contacts-edit";
import { setContactFieldValue } from "@/lib/os/fields/store";
import { fireContactEvent } from "@/lib/os/integrations/events";
import { syncNow } from "@/lib/os/integrations/queue";
import { osMockEnabled } from "@/lib/os/mock";
import { markAttendance, syncFollowupsQuietly } from "@/lib/os/sequences/engine";
import type { ViewState } from "@/lib/os/contacts-view";
import { deleteView, listViews, renameView, saveView, saveViewAs, setDefaultView, type SavedViewRecord } from "@/lib/os/saved-views";
import { stageHistory } from "@/lib/os/stage-writer";
import { markWon, promoteToSales, undoWon, wonPickerData, type MarkWonResult } from "@/lib/os/won";
import type { WonPickerData } from "@/lib/os/won-offers";

/** Follow-ups follow the change: paused / out of Sales stops them, Showed
 *  means they came to the call (Kevin's voice-note task). */
async function followupsAfter(workspaceId: string, ids: string[], change: ContactChange) {
  if (!["kind", "paused", "stage", "setterStage", "column", "addTag", "removeTag"].includes(change.type)) return;
  for (const id of ids.slice(0, 100)) {
    if (change.type === "stage" && change.stage === "SHOWED") await markAttendance(workspaceId, id, "SHOWED").catch(() => null);
    else await syncFollowupsQuietly(id, { workspaceId });
  }
}

/** Every Contacts write: bulk actions, drag between columns, the panel. */
export async function updateContacts(ids: string[], change: ContactChange): Promise<EditResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const result = await editContacts(workspaceId, ids, change);
    if (!result.error) {
      await followupsAfter(workspaceId, Array.isArray(ids) ? ids : [], change);
      revalidatePath("/os/contacts");
      revalidatePath("/os/pipeline");
      revalidatePath("/os/inbox");
      revalidatePath("/os/follow-ups");
    }
    return result;
  } catch (err) {
    console.error("[OS Contacts] update failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

/** The push panel for one contact (head + Details), loaded on click. */
export async function loadPanel(contactId: string): Promise<{ panel: ContactPanelData; details: ContactDetailsData } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const [panel, details] = await Promise.all([loadContactPanel(workspaceId, contactId), loadContactDetails(workspaceId, contactId)]);
    return panel ? { panel, details } : { error: "That contact is gone." };
  } catch (err) {
    console.error("[OS Contacts] panel failed:", err);
    return { error: "The panel didn't load." };
  }
}

/** Details tab body, for hosts that only have the panel head (the Inbox). */
export async function loadDetails(contactId: string): Promise<ContactDetailsData | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    return await loadContactDetails(workspaceId, contactId);
  } catch (err) {
    console.error("[OS Contacts] details failed:", err);
    return { error: "Details didn't load." };
  }
}

export async function loadActivity(contactId: string): Promise<ActivityItem[] | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    return await loadContactActivity(workspaceId, contactId);
  } catch (err) {
    console.error("[OS Contacts] activity failed:", err);
    return { error: "Activity didn't load." };
  }
}

/** Inline edit in the Details tab. Saved as Kevin's value; J won't overwrite it. */
export async function saveFieldValue(contactId: string, fieldKey: string, value: string | null): Promise<{ value: string | null } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const r = await setContactFieldValue(workspaceId, contactId, fieldKey, value);
    if (!("error" in r)) revalidatePath("/os/contacts");
    return r;
  } catch (err) {
    console.error("[OS Contacts] field save failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

/** "Sync now" / "Retry" on the Details tab: push to every connected CRM now (no 30s wait). */
export async function syncContactNow(contactId: string): Promise<{ ok: true } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  if (osMockEnabled()) return { ok: true };
  await syncNow({ workspaceId, contactId, event: "manual" });
  return { ok: true };
}

// --- Won picker, Undo Won, stage history (dm-crm 013, 020) ---------------------------

export async function loadWonPicker(contactIds: string[]): Promise<WonPickerData | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    return await wonPickerData(workspaceId, Array.isArray(contactIds) ? contactIds.slice(0, 2000) : []);
  } catch (err) {
    console.error("[OS Contacts] won picker failed:", err);
    return { error: "The offers didn't load." };
  }
}

function afterStageWrite() {
  revalidatePath("/os/contacts");
  revalidatePath("/os/pipeline");
  revalidatePath("/os/inbox");
  revalidatePath("/os");
}

/** Mark Won: one offer and amount, applied to each contact. `amount` null =
 *  Won with no amount (Kevin picked "No amount"). Non-sales contacts move to Sales. */
export async function markContactsWon(contactIds: string[], offer: string, amount: number | string | null): Promise<MarkWonResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const ids = Array.isArray(contactIds) ? contactIds : [];
    const r = await markWon(workspaceId, ids, amount === null ? { noAmount: true } : { offer, amount });
    if (r.error === undefined) {
      r.promoted = await promoteToSales(workspaceId, r.moved ?? []).catch((err) => {
        console.error("[OS Contacts] won → sales failed:", err);
        return [];
      });
      if (!osMockEnabled()) for (const id of ids.slice(0, 100)) await fireContactEvent({ workspaceId, contactId: id, event: "stage_changed" });
      await followupsAfter(workspaceId, ids, { type: "column", column: "won" });
      afterStageWrite();
    }
    return r;
  } catch (err) {
    console.error("[OS Contacts] won failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

/** The toast's Undo after a Won: each back off Won, and the ones Won put on
 *  Sales back in their old category. */
export async function undoContactsWon(contactIds: string[], promoted: { id: string; kind: string }[] = []): Promise<{ count: number }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { count: 0 };
  let count = 0;
  for (const id of (Array.isArray(contactIds) ? contactIds : []).slice(0, 2000)) {
    const r = await undoContactWon(id).catch(() => ({ error: "x" }));
    if ("ok" in r) count++;
  }
  const kinds = ["PERSONAL", "PITCHES", "UNSORTED"] as const;
  for (const kind of kinds) {
    const ids = (Array.isArray(promoted) ? promoted : []).filter((p) => p?.kind === kind).map((p) => p.id);
    if (ids.length) await editContacts(workspaceId, ids, { type: "kind", kind }).catch(() => null);
  }
  afterStageWrite();
  return { count };
}

export async function undoContactWon(contactId: string): Promise<{ ok: true } | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const r = await undoWon(workspaceId, contactId);
    if ("ok" in r) {
      if (!osMockEnabled()) await fireContactEvent({ workspaceId, contactId, event: "stage_changed" });
      afterStageWrite();
    }
    return r;
  } catch (err) {
    console.error("[OS Contacts] undo won failed:", err);
    return { error: "That didn't save. Try again." };
  }
}

export interface StageHistoryRow {
  id: string;
  from: string | null;
  to: string;
  outcome: string;
  cause: string;
  reason: string | null;
  at: string;
}

export async function loadStageHistory(contactId: string): Promise<StageHistoryRow[] | { error: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  try {
    const rows = await stageHistory(workspaceId, contactId, 50);
    return rows.map((r) => ({
      id: r.id,
      from: r.fromColumn,
      to: r.toColumn,
      outcome: r.outcome,
      cause: r.cause,
      reason: r.reason,
      at: typeof r.at === "string" ? r.at : r.at.toISOString(),
    }));
  } catch (err) {
    console.error("[OS Contacts] history failed:", err);
    return { error: "History didn't load." };
  }
}

// --- Saved views (dm-crm 018) --------------------------------------------------------

type ViewsResult = { views: SavedViewRecord[] } | { error: string };

async function viewsAfter(workspaceId: string, r: { ok: boolean; error?: string }): Promise<ViewsResult & { savedId?: string }> {
  if (!r.ok) return { error: r.error ?? "That didn't save." };
  revalidatePath("/os/contacts");
  return { views: await listViews(workspaceId), ...("view" in r && r.view ? { savedId: (r.view as SavedViewRecord).id } : {}) };
}

export async function saveContactView(id: string, state: ViewState): Promise<ViewsResult & { savedId?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  return viewsAfter(workspaceId, await saveView(workspaceId, id, state));
}

export async function saveContactViewAs(name: string, state: ViewState): Promise<ViewsResult & { savedId?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  return viewsAfter(workspaceId, await saveViewAs(workspaceId, name, state));
}

export async function renameContactView(id: string, name: string): Promise<ViewsResult & { savedId?: string }> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  return viewsAfter(workspaceId, await renameView(workspaceId, id, name));
}

export async function deleteContactView(id: string): Promise<ViewsResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  return viewsAfter(workspaceId, await deleteView(workspaceId, id));
}

export async function setDefaultContactView(id: string): Promise<ViewsResult> {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return { error: "Sign in again." };
  return viewsAfter(workspaceId, await setDefaultView(workspaceId, id));
}
