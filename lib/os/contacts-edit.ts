// Writes from the Contacts screen: bulk stage / kind / tag / pause changes and
// the side panel's notes and email. Every write is an updateMany scoped to
// the workspace, so an id from another workspace is a silent no-op.

import { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import { prisma } from "@/lib/db/client";
import { normalizeTag, parseEmail } from "@/lib/os/contacts-filter";
import { mockContactExtras, osMockEnabled, updateMockContact, updateMockContactExtras } from "@/lib/os/mock";

export type ContactChange =
  | { type: "stage"; stage: ContactStage }
  | { type: "kind"; kind: ContactKind }
  | { type: "paused"; paused: boolean }
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
    case "kind":
      if (!Object.values(ContactKind).includes(change.kind)) return { error: "Unknown kind." };
      // The user decided, so J's suggestion is done (same as the Inbox).
      return { data: { kind: change.kind, kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null } };
    case "paused":
      return typeof change.paused === "boolean" ? { data: { paused: change.paused } } : { error: "Pause needs on or off." };
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
  db: ContactsEditDb = prisma as unknown as ContactsEditDb
): Promise<EditResult> {
  const list = cleanIds(ids);
  if (!list) return { error: "Pick at least one contact." };
  if (change?.type === "details" && list.length !== 1) return { error: "Edit one contact at a time." };
  const plan = planChange(change);
  if ("error" in plan) return { error: plan.error };

  if (osMockEnabled()) return { count: editMock(list, plan) };

  if ("data" in plan) {
    const r = await db.contact.updateMany({ where: { id: { in: list }, workspaceId }, data: plan.data });
    return { count: r.count };
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
  }
  return { count };
}

function editMock(ids: string[], plan: { data: Data } | { tag: string; op: "add" | "remove" }): number {
  for (const id of ids) {
    if ("tag" in plan) {
      const tags = mockContactExtras(id).tags.filter((t) => t !== plan.tag);
      updateMockContactExtras(id, { tags: plan.op === "add" ? [...tags, plan.tag] : tags });
      continue;
    }
    const { notes, email, ...rest } = plan.data as { notes?: string | null; email?: string | null } & Data;
    if (notes !== undefined || email !== undefined) updateMockContactExtras(id, { notes, email });
    if (Object.keys(rest).length) updateMockContact(id, rest);
  }
  return ids.length;
}
