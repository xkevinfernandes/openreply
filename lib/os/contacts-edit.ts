// Writes from the Contacts screen: bulk stage / kind / tag / pause changes and
// the side panel's notes and email. Every write is an updateMany scoped to
// the workspace, so an id from another workspace is a silent no-op.
//
// Stage, kind, tag and email changes go to the connected CRMs through the
// same hook the Inbox actions use (fireContactEvent, lib/os/integrations),
// with the same events (stage_changed, kind_changed, tags_changed). One
// updateMany per bulk action instead of one setContactStage call per row.

import { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { normalizeTag, OUTCOME_STAGES, parseEmail } from "@/lib/os/contacts-filter";
import { osEventHooks, type OsEventHooks } from "@/lib/os/events-hooks";
import { fireContactEvent } from "@/lib/os/integrations/events";
import type { SyncEvent } from "@/lib/os/integrations/mapping";
import { mockContact, mockContactExtras, osMockEnabled, updateMockContact, updateMockContactExtras } from "@/lib/os/mock";

export type ContactChange =
  | { type: "stage"; stage: ContactStage }
  /** Dropped into a funnel column: J's stage hint. A contact sitting in an
   *  outcome (booked, won, lost…) goes back to In conversation. */
  | { type: "setterStage"; setterStage: string }
  | { type: "kind"; kind: ContactKind }
  | { type: "paused"; paused: boolean }
  /** On / off the Follow-up Friday list (Follow-ups screen). */
  | { type: "friday"; on: boolean }
  | { type: "addTag"; tag: string }
  | { type: "removeTag"; tag: string }
  | { type: "details"; notes?: string | null; email?: string | null };

export type EditResult = { count: number; error?: undefined } | { error: string; count?: undefined };

type Where = Record<string, unknown>;
type Data = Record<string, unknown>;

export interface ContactsEditDb {
  contact: {
    updateMany(args: { where: Where; data: Data }): Promise<{ count: number }>;
    findMany(args: { where: Where; select: { id: true; tags: true } }): Promise<{ id: string; tags: string[] }[]>;
  };
}

export type FireEvent = (event: { workspaceId: string; contactId: string; event: SyncEvent }) => Promise<void>;

/** The CRM event a change raises, if any (notes and pause stay local). */
export function syncEventFor(change: ContactChange): SyncEvent | null {
  switch (change.type) {
    case "stage":
    case "setterStage":
      return "stage_changed";
    case "kind":
      return "kind_changed";
    case "addTag":
    case "removeTag":
      return "tags_changed";
    case "details":
      return change.email !== undefined ? "manual" : null;
    default:
      return null;
  }
}

/** Most contacts one bulk action touches. */
export const BULK_CAP = 2000;
const NOTES_MAX = 5000;

function cleanIds(ids: unknown): string[] | null {
  if (!Array.isArray(ids)) return null;
  const out = [...new Set(ids.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 64))];
  return out.length && out.length <= BULK_CAP ? out : null;
}

/** Validates a change and turns it into the column values to write. Tag
 *  changes return the tag instead (they are per-row). */
export function planChange(change: ContactChange): { data: Data } | { tag: string; op: "add" | "remove" } | { error: string } {
  switch (change?.type) {
    case "stage":
      return Object.values(ContactStage).includes(change.stage) ? { data: { stage: change.stage } } : { error: "Unknown stage." };
    case "setterStage": {
      const hint = typeof change.setterStage === "string" ? change.setterStage.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40) : "";
      return hint ? { data: { setterStage: hint } } : { error: "Unknown column." };
    }
    case "kind":
      if (!Object.values(ContactKind).includes(change.kind)) return { error: "Unknown kind." };
      // The user decided, so J's suggestion is done (same as the Inbox).
      return { data: { kind: change.kind, kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null } };
    case "paused":
      return typeof change.paused === "boolean" ? { data: { paused: change.paused } } : { error: "Pause needs on or off." };
    case "friday":
      return typeof change.on === "boolean" ? { data: { onFriday: change.on, fridayAddedAt: change.on ? new Date() : null } } : { error: "Friday needs on or off." };
    case "addTag":
    case "removeTag": {
      const tag = typeof change.tag === "string" ? normalizeTag(change.tag) : "";
      return tag ? { tag, op: change.type === "addTag" ? "add" : "remove" } : { error: "Write a tag first." };
    }
    case "details": {
      const data: Data = {};
      if (change.notes !== undefined) {
        if (change.notes !== null && typeof change.notes !== "string") return { error: "Notes must be text." };
        const notes = change.notes?.trim() ?? "";
        if (notes.length > NOTES_MAX) return { error: `Notes are limited to ${NOTES_MAX} characters.` };
        data.notes = notes || null;
      }
      if (change.email !== undefined) {
        const parsed = parseEmail(change.email ?? "");
        if ("error" in parsed) return { error: parsed.error };
        data.email = parsed.email;
      }
      return Object.keys(data).length ? { data } : { error: "Nothing to save." };
    }
    default:
      return { error: "Unknown change." };
  }
}

export async function editContacts(
  workspaceId: string,
  ids: unknown,
  change: ContactChange,
  db: ContactsEditDb = prisma as unknown as ContactsEditDb,
  fire: FireEvent = fireContactEvent,
  // OsEvents (won) only against the real database; tests pass their own db.
  hooks: Pick<OsEventHooks, "onStageChanged"> | null = db === (prisma as unknown) ? osEventHooks : null
): Promise<EditResult> {
  const list = cleanIds(ids);
  if (!list) return { error: "Pick at least one contact." };
  if (change?.type === "details" && list.length !== 1) return { error: "Edit one contact at a time." };
  const plan = planChange(change);
  if ("error" in plan) return { error: plan.error };

  if (osMockEnabled()) return { count: editMock(list, plan) };

  const event = syncEventFor(change);
  const changed: string[] = [];
  const done = async (count: number): Promise<EditResult> => {
    // Never throws (fireContactEvent catches); one event per changed contact.
    if (event) for (const contactId of changed) await fire({ workspaceId, contactId, event });
    if (change.type === "stage" && hooks) for (const contactId of changed) await hooks.onStageChanged({ workspaceId, contactId, stage: change.stage });
    return { count };
  };

  if ("data" in plan) {
    // Which ids are really this workspace's, so only those raise CRM events.
    const mine = event ? (await db.contact.findMany({ where: { id: { in: list }, workspaceId }, select: { id: true, tags: true } })).map((r) => r.id) : list;
    if (!mine.length) return { count: 0 };
    const r = await db.contact.updateMany({ where: { id: { in: mine }, workspaceId }, data: plan.data });
    if (change.type === "setterStage") {
      await db.contact.updateMany({ where: { id: { in: mine }, workspaceId, stage: { in: OUTCOME_STAGES } }, data: { stage: "IN_CONVERSATION" } });
    }
    changed.push(...mine);
    return done(r.count);
  }

  // Tags: only rows that need the change, each written with its own new list.
  const rows = await db.contact.findMany({
    where: { id: { in: list }, workspaceId, ...(plan.op === "add" ? { NOT: { tags: { has: plan.tag } } } : { tags: { has: plan.tag } }) },
    select: { id: true, tags: true },
  });
  let count = 0;
  for (const row of rows) {
    const tags = plan.op === "add" ? [...row.tags, plan.tag] : row.tags.filter((t) => t !== plan.tag);
    const r = await db.contact.updateMany({ where: { id: row.id, workspaceId }, data: { tags } });
    count += r.count;
    if (r.count) changed.push(row.id);
  }
  return done(count);
}

function editMock(ids: string[], plan: { data: Data } | { tag: string; op: "add" | "remove" }): number {
  for (const id of ids) {
    if ("tag" in plan) {
      const tags = mockContactExtras(id).tags.filter((t) => t !== plan.tag);
      updateMockContactExtras(id, { tags: plan.op === "add" ? [...tags, plan.tag] : tags });
      continue;
    }
    const { notes, email, fridayAddedAt: _added, ...rest } = plan.data as { notes?: string | null; email?: string | null } & Data;
    void _added;
    if (notes !== undefined || email !== undefined) updateMockContactExtras(id, { notes, email });
    if ("setterStage" in rest) {
      const stage = mockContact(id)?.contact.stage;
      if (stage && OUTCOME_STAGES.includes(stage)) rest.stage = "IN_CONVERSATION";
    }
    if (Object.keys(rest).length) updateMockContact(id, rest);
  }
  return ids.length;
}
