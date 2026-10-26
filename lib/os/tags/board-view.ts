// Settings › Tags rows, pure (no database), so the client screen can use
// the helpers. The loader is lib/os/tags/board.ts.

import type { ManagedTag, TagAliasView } from "@/lib/os/tags/store";

export interface TagRow extends ManagedTag {
  contacts: number;
  /** Broadcasts (not sent yet) and workflows that use it, by name. */
  usedBy: { kind: "broadcast" | "workflow"; id: string; name: string }[];
  /** Old names that still land on it. */
  aliases: { id: string; name: string }[];
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
  workflows: { id: string; name: string; text: string }[]
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
    };
  });
  rows.sort((a, b) => Number(b.system) - Number(a.system) || a.name.localeCompare(b.name));
  return { rows, total: rows.length, system: rows.filter((r) => r.system).length };
}

/** Plain words for a tag's users: "the broadcast "Guide drop" and the workflow "SEND keyword"". */
export function usedByWords(used: { kind: "broadcast" | "workflow"; name: string }[]): string {
  const parts = used.map((u) => `the ${u.kind} "${u.name}"`);
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

