// Settings › Tags rows, pure (no database), so the client screen can use
// the helpers. The loader is lib/os/tags/board.ts.

import type { ManagedTag, TagAliasView } from "@/lib/os/tags/store";

export interface TagRow extends ManagedTag {
  contacts: number;
  /** Broadcasts (not sent yet) and workflows that use it, by name. */
  usedBy: { kind: "broadcast" | "workflow"; id: string; name: string }[];
  /** Old names that still land on it. */
  aliases: { id: string; name: string }[];
  /** Kit has received it (under its Kit name); until then there's no Kit name to keep. */
  kitSynced: boolean;
}

export interface TagBoard {
  rows: TagRow[];
  total: number;
  system: number;
}

/** System first, then by name. */
export function buildTagBoard(
  tags: ManagedTag[],
  aliases: TagAliasView[],
  contactsByName: Map<string, number>,
  broadcasts: { id: string; name: string; audienceTagId: string | null }[],
  workflows: { id: string; name: string; text: string }[],
  /** Tag names Kit has received (ContactSync.pushedTags). */
  kitSeen: ReadonlySet<string> = new Set()
): TagBoard {
  const rows = tags.map((t): TagRow => {
    const mine = aliases.filter((a) => a.tagId === t.id);
    const names = [t.name, ...mine.map((a) => a.name)].map((n) => JSON.stringify(n));
    return {
      ...t,
      contacts: contactsByName.get(t.name) ?? 0,
      usedBy: [
        ...broadcasts.filter((b) => b.audienceTagId === t.id).map((b) => ({ kind: "broadcast" as const, id: b.id, name: b.name })),
        ...workflows.filter((w) => names.some((n) => w.text.includes(n))).map((w) => ({ kind: "workflow" as const, id: w.id, name: w.name })),
      ],
      aliases: mine.map((a) => ({ id: a.id, name: a.name })),
      kitSynced: (t.kitNames.length ? t.kitNames : [t.name]).some((n) => kitSeen.has(n)),
    };
  });
  rows.sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name));
  return { rows, total: rows.length, system: rows.filter((r) => r.system).length };
}

export { usedByWords } from "@/lib/os/in-use";

