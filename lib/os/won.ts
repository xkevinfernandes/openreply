// Marking Won (dm-crm issue 013): the picker's data, and the move. A Won
// move goes through the stage writer (cause "user", one log row) and then
// stores the offer and amount on the contact's won event (lib/os/events.ts
// setWonData). Undo Won is the writer's own operation; leaving Won clears
// the amount (the writer does that). Several contacts: one choice, applied
// to each.

import { prisma } from "@/lib/db/client";
import { setWonData, wonDataOf, type WonData, type WonDb } from "@/lib/os/events";
import { osMockEnabled } from "@/lib/os/mock";
import { mockCurrency } from "@/lib/os/mock-crm";
import { MOCK_OFFERS, mockWonData, mockWonDb } from "@/lib/os/mock-contacts-crm";
import { defaultSetterId } from "@/lib/os/setter/setters";
import { writeStage, type StageWriterDeps } from "@/lib/os/stage-writer";
import { getWorkspaceSettings } from "@/lib/os/workspace-settings";
import { offersFromSetter, validateWonChoice, type WonPickerData } from "@/lib/os/won-offers";

export async function workspaceCurrency(workspaceId: string): Promise<string> {
  if (osMockEnabled()) return mockCurrency();
  try {
    return (await getWorkspaceSettings(workspaceId)).currency;
  } catch {
    return "EUR";
  }
}

/** The picker for these contacts: the first contact's setter's offers. */
export async function wonPickerData(workspaceId: string, contactIds: string[]): Promise<WonPickerData> {
  const currency = await workspaceCurrency(workspaceId);
  if (osMockEnabled()) return { currency, offers: offersFromSetter(MOCK_OFFERS), setterName: "J" };
  const c = contactIds[0] ? await prisma.contact.findFirst({ where: { id: contactIds[0], workspaceId }, select: { setterId: true, instagramAccountId: true } }) : null;
  const setterId = c?.setterId ?? (await defaultSetterId(workspaceId, c?.instagramAccountId ?? null));
  const setter = setterId ? await prisma.setter.findFirst({ where: { id: setterId, workspaceId }, select: { name: true, offers: true } }) : null;
  return { currency, offers: offersFromSetter(setter?.offers), setterName: setter?.name ?? null };
}

export interface WonDeps {
  won?: WonDb;
  stage?: StageWriterDeps;
  write?: typeof writeStage;
}

function wonDb(deps: WonDeps): WonDb {
  return deps.won ?? (osMockEnabled() ? mockWonDb() : (prisma as unknown as WonDb));
}

export type MarkWonResult = { count: number; refused: string[]; error?: undefined } | { error: string; count?: undefined };

/** Move each contact to Won and record the offer and amount on its won event. */
export async function markWon(workspaceId: string, ids: string[], choice: { offer?: unknown; amount?: unknown }, deps: WonDeps = {}): Promise<MarkWonResult> {
  const v = validateWonChoice(choice);
  if ("error" in v) return { error: v.error };
  const list = [...new Set(ids.filter((id) => typeof id === "string" && id))].slice(0, 2000);
  if (!list.length) return { error: "Pick at least one contact." };
  const write = deps.write ?? writeStage;
  const refused: string[] = [];
  let count = 0;
  for (const contactId of list) {
    const r = await write({ workspaceId, contactId, cause: "user", change: { type: "column", column: "won" } }, deps.stage);
    // Already on Won: the picker still fills in (or corrects) the amount.
    if (r.status === "applied" || r.status === "unchanged") {
      await setWonData({ workspaceId, contactId, offer: v.offer, amount: v.amount }, wonDb(deps));
      count++;
    } else refused.push(r.reason);
  }
  if (!count && refused.length) return { error: refused[0] };
  return { count, refused };
}

/** Undo Won: back to Booked when a live booking exists, else in conversation. */
export async function undoWon(workspaceId: string, contactId: string, deps: WonDeps = {}): Promise<{ ok: true } | { error: string }> {
  const r = await (deps.write ?? writeStage)({ workspaceId, contactId, cause: "user", change: { type: "undoWon" } }, deps.stage);
  if (r.status === "applied") return { ok: true };
  return { error: r.status === "unchanged" ? "Nothing to undo." : r.reason };
}

/** Won offer and amount per contact (cards, panel). */
export async function wonAmounts(workspaceId: string, contactIds: string[]): Promise<Map<string, WonData>> {
  const out = new Map<string, WonData>();
  if (!contactIds.length) return out;
  if (osMockEnabled()) {
    for (const id of contactIds) {
      const w = wonDataOf(mockWonData(id));
      if (w) out.set(id, w);
    }
    return out;
  }
  const rows = await prisma.osEvent.findMany({ where: { workspaceId, kind: "won", contactId: { in: contactIds } }, select: { contactId: true, data: true } });
  for (const r of rows) {
    const w = r.contactId ? wonDataOf(r.data) : null;
    if (w && r.contactId) out.set(r.contactId, w);
  }
  return out;
}
