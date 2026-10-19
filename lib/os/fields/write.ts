// The one write API for contact fields and tags (spec §5). Steps, J, booking,
// the system and Kevin all come through here: the value is saved with its
// history first, then the contact is marked dirty so the CRMs get one batched
// push 30s after the last write (lib/os/integrations/queue.ts).
import { prisma } from "@/lib/db/client";
import { normalizeTag } from "@/lib/os/contacts-filter";
import { coerceFieldValue, decideWrite, isLocked, storedSource, type CurrentValue, type MergeReason, type WriteSource } from "@/lib/os/fields/merge";
import type { CustomFieldType } from "@/lib/os/fields/types";
import { markDirty } from "@/lib/os/integrations/queue";
import type { SyncEvent } from "@/lib/os/integrations/mapping";

export type { WriteSource };

export interface WriteFieldInput {
  workspaceId: string;
  contactId: string;
  /** CustomField.key, e.g. "email", "monthly_revenue". */
  key: string;
  value: unknown;
  source: WriteSource;
  /** What wrote it: draft id, workflow step id, booking id. */
  ref?: string | null;
  /** When it was said; defaults to now. An older write never beats a newer one. */
  at?: Date;
  /** Sandbox / dry tools: decide only, store and sync nothing. */
  sandbox?: boolean;
}

export type WriteFieldResult =
  | { applied: true; value: string | null; pushable: boolean }
  | { applied: false; value: string | null; pushable: boolean; reason: MergeReason }
  | { error: string };

export interface WriteDeps {
  field(workspaceId: string, key: string): Promise<{ id: string; key: string; type: CustomFieldType; options: string[] } | null>;
  contactExists(workspaceId: string, contactId: string): Promise<boolean>;
  current(contactId: string, fieldId: string): Promise<CurrentValue | null>;
  /** Write (null = delete). guard: don't overwrite a locked value. False when it lost a race. */
  save(row: { contactId: string; fieldId: string; value: string | null; source: string; draftId: string | null; guard: boolean; at: Date }): Promise<boolean>;
  history(row: {
    workspaceId: string;
    contactId: string;
    fieldId: string;
    value: string | null;
    raw: string | null;
    source: WriteSource;
    ref: string | null;
    applied: boolean;
    reason: string | null;
    at: Date;
  }): Promise<void>;
  setEmail(workspaceId: string, contactId: string, email: string | null): Promise<void>;
  markDirty(e: { workspaceId: string; contactId: string; event: SyncEvent }): Promise<void>;
}

const optionsOf = (o: unknown) => (Array.isArray(o) ? o.map(String) : []);

export const dbWriteDeps: WriteDeps = {
  async field(workspaceId, key) {
    const f = await prisma.customField.findUnique({ where: { workspaceId_key: { workspaceId, key } }, select: { id: true, key: true, type: true, options: true } });
    return f ? { ...f, options: optionsOf(f.options) } : null;
  },
  async contactExists(workspaceId, contactId) {
    return Boolean(await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { id: true } }));
  },
  async current(contactId, fieldId) {
    const [r, last] = await Promise.all([
      prisma.contactFieldValue.findUnique({ where: { contactId_fieldId: { contactId, fieldId } }, select: { value: true, source: true, updatedAt: true } }),
      // When the stored value was said (a write can be saved late).
      prisma.contactFieldValueHistory.findFirst({ where: { contactId, fieldId, applied: true }, orderBy: { at: "desc" }, select: { at: true } }),
    ]);
    return r ? { value: r.value, source: r.source, at: last?.at ?? r.updatedAt } : null;
  },
  async save({ contactId, fieldId, value, source, draftId, guard }) {
    const notLocked = guard ? { source: { notIn: ["user", "kevin"] } } : {};
    if (value == null) {
      await prisma.contactFieldValue.deleteMany({ where: { contactId, fieldId, ...notLocked } });
      return true;
    }
    // updateMany guards the race with an edit Kevin made since the read.
    const updated = await prisma.contactFieldValue.updateMany({ where: { contactId, fieldId, ...notLocked }, data: { value, source, draftId } });
    if (updated.count) return true;
    const created = await prisma.contactFieldValue.createMany({ data: [{ contactId, fieldId, value, source, draftId }], skipDuplicates: true });
    return created.count > 0;
  },
  async history(row) {
    await prisma.contactFieldValueHistory.create({ data: row });
  },
  async setEmail(workspaceId, contactId, email) {
    await prisma.contact.updateMany({ where: { id: contactId, workspaceId }, data: { email } });
  },
  markDirty,
};

/**
 * Write one field on one contact under the merge rules. Every write is kept in
 * the history (also the ones that lost). An email that wins also becomes the
 * contact's email, so a corrected email updates the same Kit subscriber.
 */
export async function writeField(input: WriteFieldInput, deps: WriteDeps = dbWriteDeps): Promise<WriteFieldResult> {
  const field = await deps.field(input.workspaceId, input.key);
  if (!field) return { error: "That field is gone. Refresh." };
  const clean = coerceFieldValue(field, input.value, { strict: input.source === "kevin" });
  if ("error" in clean) return clean;
  const at = input.at ?? new Date();

  if (!input.sandbox && !(await deps.contactExists(input.workspaceId, input.contactId))) return { error: "That contact is gone. Refresh." };
  const prev = input.sandbox ? null : await deps.current(input.contactId, field.id);
  const decision = decideWrite(prev, { value: clean.value, source: input.source, at });
  if (input.sandbox) {
    return decision.apply ? { applied: true, value: clean.value, pushable: clean.pushable } : { applied: false, value: clean.value, pushable: clean.pushable, reason: decision.reason };
  }

  const ref = input.ref ?? null;
  const log = (applied: boolean, reason: string | null) =>
    deps.history({ workspaceId: input.workspaceId, contactId: input.contactId, fieldId: field.id, value: clean.value, raw: clean.raw, source: input.source, ref, applied, reason, at });

  if (!decision.apply) {
    // An empty or repeated value says nothing new: not worth a history row.
    if (decision.reason === "locked" || decision.reason === "stale") await log(false, decision.reason);
    return { applied: false, value: clean.value, pushable: clean.pushable, reason: decision.reason };
  }

  const won = await deps.save({
    contactId: input.contactId,
    fieldId: field.id,
    value: clean.value,
    source: storedSource(input.source),
    draftId: input.source === "j" ? ref : null,
    guard: input.source !== "kevin",
    at,
  });
  if (!won) {
    await log(false, "locked");
    return { applied: false, value: clean.value, pushable: clean.pushable, reason: "locked" };
  }
  await log(true, null);
  if (field.key === "email" && (clean.pushable || clean.value == null)) await deps.setEmail(input.workspaceId, input.contactId, clean.value);
  // A cleared value is never pushed as a deletion; the CRM keeps what it has.
  if (clean.value != null) await deps.markDirty({ workspaceId: input.workspaceId, contactId: input.contactId, event: field.key === "email" ? "email_captured" : "manual" });
  return { applied: true, value: clean.value, pushable: clean.pushable };
}

// --- Tags ---------------------------------------------------------------------

export interface TagDeps {
  tags(workspaceId: string, contactId: string): Promise<string[] | null>;
  setTags(workspaceId: string, contactId: string, tags: string[]): Promise<void>;
  /** Remember a removal to carry out in each CRM; null = forget it (re-added). */
  pendingRemoval(workspaceId: string, contactId: string, tag: string, remove: boolean): Promise<void>;
  markDirty(e: { workspaceId: string; contactId: string; event: SyncEvent }): Promise<void>;
}

const PROVIDERS = ["kit", "ghl"] as const;

export const dbTagDeps: TagDeps = {
  async tags(workspaceId, contactId) {
    return (await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { tags: true } }))?.tags ?? null;
  },
  async setTags(workspaceId, contactId, tags) {
    await prisma.contact.updateMany({ where: { id: contactId, workspaceId }, data: { tags } });
  },
  async pendingRemoval(workspaceId, contactId, tag, remove) {
    for (const provider of PROVIDERS) {
      const row = await prisma.contactSyncState.findUnique({ where: { contactId_provider: { contactId, provider } }, select: { removeTags: true } });
      const list = (row?.removeTags ?? []).filter((t) => t !== tag);
      if (remove) list.push(tag);
      if (!row && !remove) continue;
      await prisma.contactSyncState.upsert({
        where: { contactId_provider: { contactId, provider } },
        create: { contactId, provider, workspaceId, removeTags: list },
        update: { removeTags: list },
      });
    }
  },
  markDirty,
};

export interface TagInput {
  workspaceId: string;
  contactId: string;
  tag: string;
  source: WriteSource;
  sandbox?: boolean;
}

/** Add a tag (CRMs get it added; tags there are add-only). */
export async function addTag(input: TagInput, deps: TagDeps = dbTagDeps): Promise<{ changed: boolean } | { error: string }> {
  const tag = normalizeTag(input.tag);
  if (!tag) return { error: "Name the tag." };
  if (input.sandbox) return { changed: true };
  const tags = await deps.tags(input.workspaceId, input.contactId);
  if (!tags) return { error: "That contact is gone. Refresh." };
  await deps.pendingRemoval(input.workspaceId, input.contactId, tag, false);
  if (tags.includes(tag)) return { changed: false };
  await deps.setTags(input.workspaceId, input.contactId, [...tags, tag]);
  await deps.markDirty({ workspaceId: input.workspaceId, contactId: input.contactId, event: "tags_changed" });
  return { changed: true };
}

/** Remove a tag on purpose: the only way a tag is removed in Kit / GoHighLevel. */
export async function removeTag(input: TagInput, deps: TagDeps = dbTagDeps): Promise<{ changed: boolean } | { error: string }> {
  const tag = normalizeTag(input.tag);
  if (!tag) return { error: "Name the tag." };
  if (input.sandbox) return { changed: true };
  const tags = await deps.tags(input.workspaceId, input.contactId);
  if (!tags) return { error: "That contact is gone. Refresh." };
  await deps.pendingRemoval(input.workspaceId, input.contactId, tag, true);
  if (tags.includes(tag)) await deps.setTags(input.workspaceId, input.contactId, tags.filter((t) => t !== tag));
  await deps.markDirty({ workspaceId: input.workspaceId, contactId: input.contactId, event: "tags_changed" });
  return { changed: tags.includes(tag) };
}

/** They said stop in the DM: tag them `stopped`. Never unsubscribes them from email (Q-F2). */
export function markStopped(workspaceId: string, contactId: string, deps: TagDeps = dbTagDeps) {
  return addTag({ workspaceId, contactId, tag: "stopped", source: "system" }, deps);
}

export { isLocked };
