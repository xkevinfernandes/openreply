// SetterDoc rows: load, the one-time import from the JSON columns, saves with
// History. The JSON columns are never written here, so they stay readable as
// the fallback (profileFromRow) for one release.

import { prisma } from "@/lib/db/client";
import { profileFromRow, type SetterRowLike } from "@/lib/os/setter/kb";
import { DOC_KEYS, docsFromProfile, isDocKey, type DocKey, type SetterDocs } from "@/lib/os/setter/knowledge/docs";

/** Keystrokes from one person within this window fold into one History entry. */
export const REVISION_WINDOW_MS = 10 * 60_000;

export interface RevisionLike {
  author: string | null;
  createdAt: Date;
}

/** Pure: does this save start a new History entry, or update the last one? */
export function startsNewRevision(last: RevisionLike | null, author: string | null, now: Date): boolean {
  if (!last) return true;
  if ((last.author ?? null) !== (author ?? null)) return true;
  return now.getTime() - last.createdAt.getTime() > REVISION_WINDOW_MS;
}

export async function loadDocs(setterId: string): Promise<SetterDocs> {
  const rows = await prisma.setterDoc.findMany({ where: { setterId }, select: { key: true, body: true } });
  const out: SetterDocs = {};
  for (const r of rows) if (isDocKey(r.key)) out[r.key] = r.body;
  return out;
}

/**
 * The import: every doc this setter doesn't have yet, written from its JSON
 * columns (golden-tested to read back the same). Seed placeholders that
 * nobody edited are replaced too, so dev J drafts from the real knowledge.
 */
export async function ensureDocs(setter: SetterRowLike): Promise<void> {
  const existing = await prisma.setterDoc.findMany({
    where: { setterId: setter.id },
    select: { id: true, key: true, updatedBy: true, _count: { select: { revisions: true } } },
  });
  const have = new Map(existing.map((d) => [d.key, d]));
  const docs = docsFromProfile(profileFromRow(setter));
  for (const key of DOC_KEYS) {
    const d = have.get(key);
    const body = docs[key];
    if (!d) {
      await prisma.setterDoc
        .create({ data: { setterId: setter.id, key, body, updatedBy: "import", revisions: { create: { body, author: "import" } } } })
        .catch(() => undefined); // a parallel request made it first
    } else if (d.updatedBy === "seed" && d._count.revisions <= 1) {
      await prisma.setterDoc.update({ where: { id: d.id }, data: { body, updatedBy: "import", revisions: { create: { body, author: "import" } } } });
    }
  }
}

export async function saveDocBody(setterId: string, key: DocKey, body: string, author: string | null, now = new Date()) {
  const doc = await prisma.setterDoc.upsert({
    where: { setterId_key: { setterId, key } },
    create: { setterId, key, body, updatedBy: author },
    update: { body, updatedBy: author },
  });
  const last = await prisma.setterDoc
    .findUnique({ where: { id: doc.id }, select: { revisions: { orderBy: { createdAt: "desc" }, take: 1 } } })
    .then((d) => d?.revisions[0] ?? null);
  if (last && last.body === body) return doc;
  if (startsNewRevision(last, author, now)) await prisma.setterDocRevision.create({ data: { docId: doc.id, body, author } });
  else await prisma.setterDocRevision.update({ where: { id: last!.id }, data: { body } });
  return doc;
}

export interface DocRevisionView {
  id: string;
  author: string | null;
  at: string;
}

export interface DocView {
  key: DocKey;
  body: string;
  updatedAt: string | null;
  revisions: DocRevisionView[];
}

export async function loadDocViews(setterId: string): Promise<DocView[]> {
  const rows = await prisma.setterDoc.findMany({
    where: { setterId },
    include: { revisions: { orderBy: { createdAt: "desc" }, take: 12, select: { id: true, author: true, createdAt: true } } },
  });
  return DOC_KEYS.map((key) => {
    const r = rows.find((x) => x.key === key);
    return {
      key,
      body: r?.body ?? "",
      updatedAt: r?.updatedAt.toISOString() ?? null,
      revisions: (r?.revisions ?? []).map((v) => ({ id: v.id, author: v.author, at: v.createdAt.toISOString() })),
    };
  });
}

export async function revisionBody(setterId: string, revisionId: string): Promise<{ key: DocKey; body: string } | null> {
  const rev = await prisma.setterDocRevision.findFirst({ where: { id: revisionId, doc: { setterId } }, include: { doc: { select: { key: true } } } });
  return rev && isDocKey(rev.doc.key) ? { key: rev.doc.key, body: rev.body } : null;
}

/** Setup › Fields J fills, for J's prompt. */
export async function fieldsForSetter(setterId: string) {
  const links = await prisma.setterField.findMany({ where: { setterId }, include: { field: true } });
  return links
    .map((l) => l.field)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((f) => ({ key: f.key, label: f.label, type: f.type }));
}
