// The ⌘K palette's index: contacts (with their stage and a draft dot),
// setters' funnel columns and lead magnets (for "Move to stage…" and
// "Send lead magnet…"), and KB docs. Loaded once when the palette opens.

import { prisma } from "@/lib/db/client";
import { columnFor, funnelColumns, type FunnelColumn } from "@/lib/os/funnel";
import { mockThreads, osMockEnabled } from "@/lib/os/mock";
import { DOC_FILES, type PaletteContact, type PaletteDoc } from "@/lib/os/palette/search";
import { asFunnel } from "@/lib/os/setter/kb";
import { pendingDrafts } from "@/lib/os/setter/service";

export interface PaletteIndex {
  contacts: PaletteContact[];
  docs: PaletteDoc[];
  /** Funnel columns per setter id ("" = the default setter). */
  stages: Record<string, { key: string; label: string }[]>;
  resources: { id: string; name: string }[];
}

const docHref = (setterId: string, key: string) => `/os/knowledge/${setterId}?doc=${key}`;

export async function loadPaletteIndex(workspaceId: string): Promise<PaletteIndex> {
  const [setters, resources, drafts] = await Promise.all([
    prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true, isDefault: true, funnel: true }, orderBy: { createdAt: "asc" } }),
    prisma.resource.findMany({ where: { workspaceId, kind: "resource" }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    pendingDrafts(workspaceId).catch(() => []),
  ]);
  const ordered = [...setters.filter((s) => s.isDefault), ...setters.filter((s) => !s.isDefault)];
  const cols = new Map<string, FunnelColumn[]>(ordered.map((s) => [s.id, funnelColumns(asFunnel(s.funnel))]));
  const defaultCols = ordered[0] ? cols.get(ordered[0].id)! : funnelColumns(null);
  const waiting = new Set(drafts.map((d) => d.contactId));

  type Row = { id: string; username: string | null; fullName: string | null; conversationId: string | null; stage: Parameters<typeof columnFor>[0]["stage"]; setterStage: string | null; setterId: string | null };
  let rows: Row[];
  if (osMockEnabled()) {
    rows = mockThreads()
      .filter((t) => t.contact)
      .map((t) => ({ id: t.contact!.id, username: t.username, fullName: t.fullName ?? null, conversationId: t.conversationId, stage: t.contact!.stage, setterStage: t.contact!.setterStage ?? null, setterId: null }));
  } else {
    const found = await prisma.contact.findMany({
      where: { workspaceId },
      select: { id: true, username: true, fullName: true, zernioConversationId: true, stage: true, setterStage: true, setterId: true },
      orderBy: { lastMessageAt: { sort: "desc", nulls: "last" } },
      take: 3000,
    });
    rows = found.map((c) => ({ ...c, conversationId: c.zernioConversationId }));
  }

  const contacts: PaletteContact[] = rows.map((r) => {
    const c = (r.setterId && cols.get(r.setterId)) || defaultCols;
    const key = columnFor({ stage: r.stage, setterStage: r.setterStage }, c);
    return {
      id: r.id,
      username: r.username,
      fullName: r.fullName,
      conversationId: r.conversationId,
      stage: c.find((x) => x.key === key)?.label ?? null,
      draftWaiting: waiting.has(r.id),
      setterId: r.setterId,
    };
  });
  // Waiting threads first, so an empty query and ties favour them.
  contacts.sort((a, b) => Number(b.draftWaiting) - Number(a.draftWaiting));

  const docs: PaletteDoc[] = ordered.flatMap((s) =>
    Object.entries(DOC_FILES).map(([key, file]) => ({ setterId: s.id, setterName: s.name, key, file, href: docHref(s.id, key) }))
  );
  const stages: PaletteIndex["stages"] = { "": defaultCols.map((c) => ({ key: c.key, label: c.label })) };
  for (const [id, c] of cols) stages[id] = c.map((x) => ({ key: x.key, label: x.label }));
  return { contacts, docs, stages, resources };
}

export interface DocHit {
  setterId: string;
  setterName: string;
  key: string;
  file: string;
  href: string;
  snippet: string;
}

/** SetterDoc full text ("mentions “Notion”"). */
export async function searchSetterDocs(workspaceId: string, q: string): Promise<DocHit[]> {
  const text = q.trim();
  if (text.length < 2) return [];
  const setters = await prisma.setter.findMany({ where: { workspaceId }, select: { id: true, name: true } });
  if (!setters.length) return [];
  const names = new Map(setters.map((s) => [s.id, s.name]));
  const docs = await prisma.setterDoc.findMany({
    where: { setterId: { in: setters.map((s) => s.id) }, body: { contains: text, mode: "insensitive" } },
    select: { setterId: true, key: true },
    take: 8,
  });
  return docs.map((d) => ({
    setterId: d.setterId,
    setterName: names.get(d.setterId) ?? "Setter",
    key: d.key,
    file: DOC_FILES[d.key] ?? `${d.key}.md`,
    href: docHref(d.setterId, d.key),
    snippet: `mentions “${text}”`,
  }));
}
