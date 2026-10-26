// Managed tags (dm-crm slice 2): the per-workspace list, its old names
// (aliases) and the rules around them. Contacts keep tag names
// (Contact.tags); the one writer of those is lib/os/fields/write.ts, which
// resolves every name it writes through resolveTag / ensureTag here.
//
// Resolution order: current name, then the key (case/space/separator
// variants), then an alias (an old name after a rename or merge). Only then is
// a new tag created. A name held as an alias can't become a new tag.
//
// Postgres, or memory with OS_MOCK=1 (lib/os/mock-crm.ts).

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { cleanTagName, SYSTEM_TAGS, systemTagFor, tagKey } from "@/lib/os/tags/key";
import { DEFAULT_TAG_COLOR, isTagColor } from "@/lib/os/tags/palette";

export interface ManagedTag {
  id: string;
  name: string;
  key: string;
  color: string;
  /** Primary first (lib/os/tags/kit.ts). */
  kitNames: string[];
  system: boolean;
  /** System tags: what reads it (the badge's tooltip). */
  readBy: string | null;
}

export interface TagAliasView {
  id: string;
  name: string;
  tagId: string;
}

export interface TagUsage {
  contacts: number;
  /** Broadcasts not yet sent that use it as their audience. */
  broadcasts: { id: string; key: string; name: string }[];
  /** Workflows whose current version or draft names it. */
  workflows: { id: string; name: string }[];
}

export type TagResult<T = ManagedTag> = ({ ok: true } & { tag: T }) | { ok: false; error: string };

type Row = { id: string; name: string; key: string; color: string; kitNames: string[]; system: boolean };

export function tagView(r: Row): ManagedTag {
  return {
    id: r.id,
    name: r.name,
    key: r.key,
    color: r.color,
    kitNames: r.kitNames?.length ? r.kitNames : [r.name],
    system: r.system,
    readBy: r.system ? (systemTagFor(r.name)?.readBy ?? "Read by name") : null,
  };
}

const SELECT = { id: true, name: true, key: true, color: true, kitNames: true, system: true } as const;

/** Storage behind the rules, so the rules are testable without a database. */
export interface TagStoreDb {
  list(workspaceId: string): Promise<Row[]>;
  byName(workspaceId: string, name: string): Promise<Row | null>;
  byKey(workspaceId: string, key: string): Promise<Row | null>;
  aliasByKey(workspaceId: string, key: string): Promise<(TagAliasView & { tag: Row }) | null>;
  aliases(workspaceId: string): Promise<TagAliasView[]>;
  create(workspaceId: string, data: { name: string; key: string; color: string; kitNames: string[]; system: boolean }): Promise<Row>;
}

const dbStore: TagStoreDb = {
  list: (workspaceId) => prisma.tag.findMany({ where: { workspaceId }, select: SELECT, orderBy: { name: "asc" } }),
  byName: (workspaceId, name) => prisma.tag.findUnique({ where: { workspaceId_name: { workspaceId, name } }, select: SELECT }),
  byKey: (workspaceId, key) => prisma.tag.findUnique({ where: { workspaceId_key: { workspaceId, key } }, select: SELECT }),
  async aliasByKey(workspaceId, key) {
    const a = await prisma.tagAlias.findFirst({ where: { workspaceId, key }, orderBy: { createdAt: "desc" }, select: { id: true, name: true, tagId: true, tag: { select: SELECT } } });
    return a ?? null;
  },
  aliases: (workspaceId) => prisma.tagAlias.findMany({ where: { workspaceId }, select: { id: true, name: true, tagId: true }, orderBy: { name: "asc" } }),
  async create(workspaceId, data) {
    // A concurrent writer may have created it a moment ago: take theirs.
    const made = await prisma.tag.createManyAndReturn({ data: [{ workspaceId, ...data }], skipDuplicates: true, select: SELECT });
    return made[0] ?? (await prisma.tag.findUniqueOrThrow({ where: { workspaceId_key: { workspaceId, key: data.key } }, select: SELECT }));
  },
};

async function store(): Promise<TagStoreDb> {
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockTagStore();
  return dbStore;
}

/** The workspace's tags, system tags first seeded if missing (a workspace
 *  made after the seed migration gets them on first read). */
export async function listTags(workspaceId: string, db?: TagStoreDb): Promise<ManagedTag[]> {
  const s = db ?? (await store());
  let rows = await s.list(workspaceId);
  const missing = SYSTEM_TAGS.filter((t) => !rows.some((r) => r.key === tagKey(t.name)));
  if (missing.length) {
    for (const t of missing) await s.create(workspaceId, { name: t.name, key: tagKey(t.name), color: DEFAULT_TAG_COLOR, kitNames: [t.name], system: true });
    rows = await s.list(workspaceId);
  }
  return rows.map(tagView);
}

export async function listTagAliases(workspaceId: string, db?: TagStoreDb): Promise<TagAliasView[]> {
  return (db ?? (await store())).aliases(workspaceId);
}

/** The managed tag a written name means, or null: name, key, then alias. */
export async function resolveTag(workspaceId: string, name: string, db?: TagStoreDb): Promise<ManagedTag | null> {
  const s = db ?? (await store());
  const clean = cleanTagName(name);
  const key = tagKey(clean);
  if (!key) return null;
  const hit = (await s.byName(workspaceId, clean)) ?? (await s.byKey(workspaceId, key)) ?? (await s.aliasByKey(workspaceId, key))?.tag ?? null;
  return hit ? tagView(hit) : null;
}

/** Why a new tag can't take this name, or null. */
export async function nameTaken(workspaceId: string, name: string, db?: TagStoreDb, exceptTagId?: string): Promise<string | null> {
  const s = db ?? (await store());
  const key = tagKey(name);
  if (!key) return "Name the tag.";
  const live = await s.byKey(workspaceId, key);
  if (live && live.id !== exceptTagId) return `There's already a tag called ${live.name}.`;
  const alias = await s.aliasByKey(workspaceId, key);
  if (alias && alias.tagId !== exceptTagId) return `This was the old name of ${alias.tag.name}.`;
  return null;
}

/** Create a tag from the list (Settings › Tags, "create" in a picker). */
export async function createTag(workspaceId: string, input: { name: string; color?: string }, db?: TagStoreDb): Promise<TagResult> {
  const s = db ?? (await store());
  const name = cleanTagName(input.name);
  const taken = await nameTaken(workspaceId, name, s);
  if (taken) return { ok: false, error: taken };
  const sys = systemTagFor(name);
  const row = await s.create(workspaceId, {
    name: sys?.name ?? name,
    key: tagKey(name),
    color: isTagColor(input.color) ? input.color : DEFAULT_TAG_COLOR,
    kitNames: [sys?.name ?? name],
    system: Boolean(sys),
  });
  return { ok: true, tag: tagView(row) };
}

/**
 * The managed tag for a name written anywhere (J, a workflow step, an import,
 * the contact panel): resolved, else created. Never refused: a name that is
 * an old name lands on the tag it became.
 */
export async function ensureTag(workspaceId: string, name: string, db?: TagStoreDb): Promise<ManagedTag | null> {
  const s = db ?? (await store());
  const hit = await resolveTag(workspaceId, name, s);
  if (hit) return hit;
  const clean = cleanTagName(name);
  if (!tagKey(clean)) return null;
  const made = await createTag(workspaceId, { name: clean }, s);
  return made.ok ? made.tag : await resolveTag(workspaceId, name, s);
}

// --- Changes to the list (Settings › Tags) -------------------------------------
// Each one that touches contacts goes through the tag writer's bulk helpers
// (lib/os/fields/write.ts), in one transaction with the tag change.

async function own(workspaceId: string, id: string) {
  return prisma.tag.findFirst({ where: { id, workspaceId }, select: SELECT });
}

/** Rename: contacts, setters' tag options and an alias for the old name, in
 *  one transaction. Kit names don't change (Kit keeps seeing the same tag). */
export async function renameTag(workspaceId: string, id: string, newName: string): Promise<TagResult> {
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockRenameTag(workspaceId, id, newName);
  const tag = await own(workspaceId, id);
  if (!tag) return { ok: false, error: "That tag is gone. Refresh." };
  if (tag.system) return { ok: false, error: `${tag.name} is a system tag: ${systemTagFor(tag.name)?.readBy ?? "something"} reads it by name.` };
  const name = cleanTagName(newName);
  if (name === tag.name) return { ok: true, tag: tagView(tag) };
  const taken = await nameTaken(workspaceId, name, dbStore, tag.id);
  if (taken) return { ok: false, error: taken };
  if (systemTagFor(name)) return { ok: false, error: `${name} is a system tag name.` };
  const { renameTagOnContacts } = await import("@/lib/os/fields/write");
  const updated = await prisma.$transaction(async (tx) => {
    // The new name may be one of this tag's own old names: it stops being an alias.
    await tx.tagAlias.deleteMany({ where: { workspaceId, tagId: tag.id, key: tagKey(name) } });
    await tx.tagAlias.upsert({
      where: { workspaceId_name: { workspaceId, name: tag.name } },
      create: { workspaceId, tagId: tag.id, name: tag.name, key: tag.key },
      update: { tagId: tag.id, key: tag.key },
    });
    const row = await tx.tag.update({ where: { id: tag.id }, data: { name, key: tagKey(name) }, select: SELECT });
    await renameTagOnContacts(tx, workspaceId, tag.name, name);
    // J writes the new name from now on.
    const setters = await tx.setter.findMany({ where: { workspaceId }, select: { id: true, settings: true } });
    for (const s of setters) {
      const settings = (s.settings ?? {}) as Record<string, unknown>;
      const opts = settings.tag_options;
      if (!Array.isArray(opts) || !opts.some((o) => typeof o === "string" && tagKey(o) === tag.key)) continue;
      const next = [...new Set(opts.map((o) => (typeof o === "string" && tagKey(o) === tag.key ? name : o)))];
      await tx.setter.update({ where: { id: s.id }, data: { settings: { ...settings, tag_options: next } } });
    }
    return row;
  });
  return { ok: true, tag: tagView(updated) };
}

export async function setTagColor(workspaceId: string, id: string, color: string): Promise<TagResult> {
  if (!isTagColor(color)) return { ok: false, error: "Pick a colour from the list." };
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockSetTagColor(workspaceId, id, color);
  const r = await prisma.tag.updateMany({ where: { id, workspaceId }, data: { color } });
  if (!r.count) return { ok: false, error: "That tag is gone. Refresh." };
  return { ok: true, tag: tagView((await own(workspaceId, id))!) };
}

/** Where a tag is used: contacts, unsent broadcasts, workflows. */
export async function tagUsage(workspaceId: string, id: string): Promise<TagUsage> {
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockTagUsage(workspaceId, id);
  const tag = await own(workspaceId, id);
  if (!tag) return { contacts: 0, broadcasts: [], workflows: [] };
  const names = [tag.name, ...(await prisma.tagAlias.findMany({ where: { tagId: id }, select: { name: true } })).map((a) => a.name)];
  const [contacts, broadcasts, workflows] = await Promise.all([
    prisma.contact.count({ where: { workspaceId, tags: { has: tag.name } } }),
    prisma.broadcast.findMany({ where: { workspaceId, audienceTagId: id, status: { notIn: ["sent", "cancelled"] } }, select: { id: true, key: true, name: true } }),
    prisma.workflow.findMany({ where: { workspaceId }, select: { id: true, name: true, draftGraph: true, currentVersionId: true, versions: { select: { id: true, graph: true } } } }),
  ]);
  const usesName = (graph: unknown) => {
    const text = JSON.stringify(graph ?? null);
    return names.some((n) => text.includes(JSON.stringify(n)));
  };
  return {
    contacts,
    broadcasts,
    workflows: workflows
      .filter((w) => usesName(w.draftGraph) || usesName(w.versions.find((v) => v.id === w.currentVersionId)?.graph))
      .map((w) => ({ id: w.id, name: w.name })),
  };
}

/** Delete: refused for system tags, and while a broadcast or workflow uses
 *  it unless forced. Removes it from every contact. */
export async function deleteTag(workspaceId: string, id: string, opts: { force?: boolean } = {}): Promise<{ ok: true } | { ok: false; error: string; usage?: TagUsage }> {
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockDeleteTag(workspaceId, id, opts);
  const tag = await own(workspaceId, id);
  if (!tag) return { ok: false, error: "That tag is gone. Refresh." };
  if (tag.system) return { ok: false, error: `${tag.name} is a system tag: ${systemTagFor(tag.name)?.readBy ?? "something"} reads it by name.` };
  const usage = await tagUsage(workspaceId, id);
  if (!opts.force && (usage.broadcasts.length || usage.workflows.length)) {
    const names = [...usage.broadcasts.map((b) => b.name), ...usage.workflows.map((w) => w.name)];
    return { ok: false, error: `Used by ${names.join(", ")}.`, usage };
  }
  const { removeTagFromAllContacts } = await import("@/lib/os/fields/write");
  await prisma.$transaction(async (tx) => {
    await removeTagFromAllContacts(tx, workspaceId, tag.name);
    await tx.broadcast.updateMany({ where: { workspaceId, audienceTagId: id, status: { notIn: ["sent", "cancelled"] } }, data: { audienceTagId: null } });
    await tx.tag.delete({ where: { id } });
  });
  return { ok: true };
}

/** Free an old name so it no longer lands on its tag (and can be used again). */
export async function freeAlias(workspaceId: string, aliasId: string): Promise<{ ok: boolean }> {
  if (osMockEnabled()) return (await import("@/lib/os/mock-crm")).mockFreeAlias(workspaceId, aliasId);
  const r = await prisma.tagAlias.deleteMany({ where: { id: aliasId, workspaceId } });
  return { ok: r.count > 0 };
}
