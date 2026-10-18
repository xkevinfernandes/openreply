// Filtering and grouping for the Contacts screen. Pure: runs in the browser
// and in tests.

import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import type { ContactRow } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import { stageOrder } from "@/lib/os/labels";

export interface ContactFilters {
  /** "sales" (the default) shows only Sales contacts; "all" adds the rest. */
  scope: "sales" | "all";
  /** Only with scope "all". Empty = any. */
  kind: ContactKind | "";
  stage: ContactStage | "";
  /** An entryKey, or "none". */
  entry: string;
  /** A setter id, or "default" for contacts on the account's default setter. */
  setter: string;
  tag: string;
  query: string;
}

export const emptyFilters: ContactFilters = { scope: "sales", kind: "", stage: "", entry: "", setter: "", tag: "", query: "" };

/** setter_comment reads as Comment everywhere, so it filters as one too. */
export function entryKey(entryPath: string | null | undefined): string {
  if (!entryPath) return "none";
  return entryPath === "setter_comment" ? "comment" : entryPath;
}

export function matchesQuery(c: ContactRow, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return [c.username, c.fullName, c.email, c.notes, ...c.tags].some((v) => (v ?? "").toLowerCase().includes(q));
}

export function filterContacts(rows: ContactRow[], f: ContactFilters): ContactRow[] {
  return rows.filter(
    (c) =>
      (f.scope === "sales" ? c.kind === "SALES" : !f.kind || c.kind === f.kind) &&
      (!f.stage || c.stage === f.stage) &&
      (!f.entry || entryKey(c.entryPath) === f.entry) &&
      (!f.setter || (f.setter === "default" ? c.setterId == null : c.setterId === f.setter)) &&
      (!f.tag || c.tags.includes(f.tag)) &&
      matchesQuery(c, f.query)
  );
}

/** How many of the filter-panel filters are on (not scope or search). */
export function activeFilterCount(f: ContactFilters): number {
  return [f.scope === "all" && f.kind, f.stage, f.entry, f.setter, f.tag].filter(Boolean).length;
}

/** One list per Kanban column, in stageOrder, each newest message first. */
export function groupByStage(rows: ContactRow[]): Record<ContactStage, ContactRow[]> {
  const out = Object.fromEntries(stageOrder.map((s) => [s, [] as ContactRow[]])) as Record<ContactStage, ContactRow[]>;
  for (const c of rows) out[c.stage].push(c);
  return out;
}

/** The column to the left (-1) or right (+1), or null at either end. */
export function stepStage(stage: ContactStage, dir: -1 | 1): ContactStage | null {
  const i = stageOrder.indexOf(stage) + dir;
  return i >= 0 && i < stageOrder.length ? stageOrder[i] : null;
}

export function allTags(rows: ContactRow[]): string[] {
  return [...new Set(rows.flatMap((c) => c.tags))].sort((a, b) => a.localeCompare(b));
}

/** A tag as stored: trimmed, lower case, single spaces, at most 40 chars. */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 40);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trimmed email, null for blank, or an error for something that isn't one. */
export function parseEmail(raw: string): { email: string | null } | { error: string } {
  const v = raw.trim();
  if (!v) return { email: null };
  return EMAIL.test(v) && v.length <= 254 ? { email: v } : { error: "That doesn't look like an email address." };
}

/** The change as the browser shows it before the server answers. */
export function applyChangeLocally(rows: ContactRow[], ids: string[], change: ContactChange): ContactRow[] {
  const set = new Set(ids);
  return rows.map((c) => {
    if (!set.has(c.id)) return c;
    switch (change.type) {
      case "stage":
        return { ...c, stage: change.stage };
      case "kind":
        return { ...c, kind: change.kind };
      case "paused":
        return { ...c, paused: change.paused };
      case "friday":
        return { ...c, onFriday: change.on };
      case "addTag": {
        const tag = normalizeTag(change.tag);
        return tag && !c.tags.includes(tag) ? { ...c, tags: [...c.tags, tag] } : c;
      }
      case "removeTag": {
        const tag = normalizeTag(change.tag);
        return { ...c, tags: c.tags.filter((t) => t !== tag) };
      }
      case "details":
        return {
          ...c,
          ...(change.notes !== undefined ? { notes: change.notes?.trim() || null } : {}),
          ...(change.email !== undefined ? { email: change.email?.trim() || null } : {}),
        };
    }
  });
}
