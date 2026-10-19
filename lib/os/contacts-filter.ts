// Filtering and grouping for the Contacts screen. Pure: runs in the browser
// and in tests.

import type { ContactKind, ContactStage } from "@/app/generated/prisma/enums";
import type { ContactRow } from "@/lib/os/contacts-board";
import type { ContactChange } from "@/lib/os/contacts-edit";
import { columnFor, type FunnelColumn } from "@/lib/os/funnel";
import { entryLabels, stageOrder } from "@/lib/os/labels";

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
  /** The keyword or surface they came in on (row.source). Empty = any. */
  source: string;
  query: string;
}

export const emptyFilters: ContactFilters = { scope: "sales", kind: "", stage: "", entry: "", setter: "", tag: "", source: "", query: "" };

/** ContactStages that pin a card to an outcome column (lib/os/funnel.ts columnFor). */
export const OUTCOME_STAGES: ContactStage[] = ["CALL_BOOKED", "SHOWED", "WON", "LOST", "NOT_QUALIFIED"];

/** The card's source line: the keyword they triggered, else how they came in. */
export function sourceOf(c: Pick<ContactRow, "source" | "entryPath">): string {
  if (c.source) return c.source;
  if (c.entryPath === "comment" || c.entryPath === "setter_comment") return "Reel comment";
  return c.entryPath ? (entryLabels[c.entryPath] ?? c.entryPath) : "Direct";
}

/** Every source on the board, keywords first. */
export function allSources(rows: ContactRow[]): string[] {
  const all = [...new Set(rows.map(sourceOf))];
  const kw = (s: string) => /^[A-Z0-9_]+$/.test(s);
  return all.sort((a, b) => Number(kw(b)) - Number(kw(a)) || a.localeCompare(b));
}

/** Category chip ↔ scope + kind. */
export function categoryOf(f: Pick<ContactFilters, "scope" | "kind">): ContactKind | "" {
  return f.scope === "sales" ? "SALES" : f.kind;
}

export function withCategory(f: ContactFilters, kind: ContactKind | ""): ContactFilters {
  return kind === "SALES" ? { ...f, scope: "sales", kind: "" } : { ...f, scope: "all", kind };
}

/** One list per funnel column (lib/os/funnel.ts), in column order. */
export function groupByColumn(rows: ContactRow[], columns: FunnelColumn[]): Map<string, ContactRow[]> {
  const out = new Map(columns.map((c) => [c.key, [] as ContactRow[]]));
  for (const c of rows) {
    const key = columnFor({ stage: c.stage, setterStage: c.setterStage, attendance: c.attendance ?? null }, columns);
    (out.get(key) ?? out.get(columns[0]?.key ?? "")!)?.push(c);
  }
  return out;
}

/** Showed and No-show share one column on the board. */
export interface BoardColumn {
  key: string;
  label: string;
  keys: string[];
}

export function boardColumns(columns: FunnelColumn[]): BoardColumn[] {
  const out: BoardColumn[] = [];
  for (const c of columns) {
    if (c.key === "no_show") {
      const showed = out.find((x) => x.key === "showed");
      if (showed) {
        showed.keys.push("no_show");
        showed.label = "Showed / No-show";
        continue;
      }
    }
    out.push({ key: c.key, label: c.label, keys: [c.key] });
  }
  return out;
}

/** Does this setter's board show the contact? "" = every setter. */
export function onSetter(c: Pick<ContactRow, "setterId">, setter: string, defaultId: string | null): boolean {
  if (!setter) return true;
  const id = c.setterId ?? defaultId;
  return setter === "default" ? c.setterId == null : id === setter;
}

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
      (!f.source || sourceOf(c) === f.source) &&
      matchesQuery(c, f.query)
  );
}

/** How many of the filter-panel filters are on (not scope or search). */
export function activeFilterCount(f: ContactFilters): number {
  return [f.scope === "all" && f.kind, f.stage, f.entry, f.setter, f.tag, f.source].filter(Boolean).length;
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
      case "setterStage":
        return { ...c, setterStage: change.setterStage, stage: OUTCOME_STAGES.includes(c.stage) ? "IN_CONVERSATION" : c.stage, attendance: null };
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
