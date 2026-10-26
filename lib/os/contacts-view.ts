// The Contacts table's query layer (dm-crm issues 017/018): which columns a
// view shows, its filters (tags by id), sort, search and 50-row pages. Pure,
// so it runs in the browser on the loaded rows and in tests. A saved view
// (lib/os/saved-views.ts) stores columns, filters and sort; search and the
// page never are.

import type { ContactKind } from "@/app/generated/prisma/enums";
import type { ContactRow } from "@/lib/os/contacts-board";
import { onSetter, sourceOf } from "@/lib/os/contacts-filter";
import { columnFor, funnelColumns, type FunnelColumn } from "@/lib/os/funnel";

export const PAGE_SIZE = 50;

/** Built-in table columns; custom fields are "field:<key>". */
export const BUILT_IN_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "stage", label: "Stage" },
  { key: "setter", label: "Setter" },
  { key: "category", label: "Category" },
  { key: "source", label: "Source" },
  { key: "tags", label: "Tags" },
  { key: "last", label: "Last activity" },
  { key: "created", label: "Created" },
] as const;

export type BuiltInColumn = (typeof BUILT_IN_COLUMNS)[number]["key"];

/** Name is always first and can't be hidden. */
export const DEFAULT_COLUMNS = ["name", "email", "stage", "setter", "tags", "last", "created"];

export type ActivityFilter = "" | "24h" | "7d" | "30d" | "quiet30";

export const ACTIVITY_OPTIONS: { value: ActivityFilter; label: string }[] = [
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "quiet30", label: "Quiet 30+ days" },
];

export interface ViewFilters {
  /** Managed tag ids (a rename never breaks a view). All must match. */
  tagIds: string[];
  /** A board column key (setter stage, booked, showed, no_show, won, lost). */
  stage: string;
  /** A setter id; contacts with no setter count as the default setter's. */
  setter: string;
  category: ContactKind | "";
  source: string;
  activity: ActivityFilter;
  /** Archived contacts only (hidden otherwise). */
  archived: boolean;
}

export interface ViewSort {
  key: string;
  dir: "asc" | "desc";
}

export interface ViewState {
  columns: string[];
  filters: ViewFilters;
  sort: ViewSort;
}

export const EMPTY_FILTERS: ViewFilters = { tagIds: [], stage: "", setter: "", category: "", source: "", activity: "", archived: false };
export const DEFAULT_SORT: ViewSort = { key: "last", dir: "desc" };
export const DEFAULT_VIEW: ViewState = { columns: DEFAULT_COLUMNS, filters: EMPTY_FILTERS, sort: DEFAULT_SORT };

const KINDS: ContactKind[] = ["SALES", "PERSONAL", "PITCHES", "UNSORTED"];
const ACTIVITY: ActivityFilter[] = ["", "24h", "7d", "30d", "quiet30"];

/** Stored JSON → a clean view state (anything unknown falls back to defaults). */
export function parseViewState(columns: unknown, filters: unknown, sort: unknown): ViewState {
  const cols = Array.isArray(columns) ? [...new Set(columns.filter((c): c is string => typeof c === "string" && c.length > 0 && c.length <= 80))] : [];
  const f = filters && typeof filters === "object" ? (filters as Record<string, unknown>) : {};
  const s = sort && typeof sort === "object" ? (sort as Record<string, unknown>) : {};
  const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 80) : "");
  return {
    columns: withName(cols.length ? cols : DEFAULT_COLUMNS),
    filters: {
      tagIds: Array.isArray(f.tagIds) ? [...new Set(f.tagIds.filter((t): t is string => typeof t === "string" && t.length > 0))].slice(0, 20) : [],
      stage: str(f.stage),
      setter: str(f.setter),
      category: KINDS.includes(f.category as ContactKind) ? (f.category as ContactKind) : "",
      source: str(f.source),
      activity: ACTIVITY.includes(f.activity as ActivityFilter) ? (f.activity as ActivityFilter) : "",
      archived: f.archived === true,
    },
    sort: { key: str(s.key) || DEFAULT_SORT.key, dir: s.dir === "asc" ? "asc" : "desc" },
  };
}

function withName(cols: string[]): string[] {
  return ["name", ...cols.filter((c) => c !== "name")];
}

/** Same columns, filters and sort (order of tag ids doesn't matter). */
export function sameView(a: ViewState, b: ViewState): boolean {
  const norm = (v: ViewState) => JSON.stringify({ c: withName(v.columns), f: { ...v.filters, tagIds: [...v.filters.tagIds].sort() }, s: v.sort });
  return norm(a) === norm(b);
}

export function activeFilterCount(f: ViewFilters): number {
  return f.tagIds.length + [f.stage, f.setter, f.category, f.source, f.activity].filter(Boolean).length + (f.archived ? 1 : 0);
}

// --- Rows -------------------------------------------------------------------------

export interface QueryContext {
  now: number;
  /** Tag id → its current name (contacts keep names). */
  tagNames: Map<string, string>;
  /** The default setter's id (contacts with no setter belong to it). */
  defaultSetterId: string | null;
  /** Board columns per setter id (stage column + filter). */
  columnsFor: (setterId: string | null) => FunnelColumn[];
}

/** The board column a contact sits in, on its own setter's board. */
export function stageKeyOf(c: ContactRow, ctx: Pick<QueryContext, "columnsFor" | "defaultSetterId">): string {
  return columnFor({ stage: c.stage, setterStage: c.setterStage, attendance: c.attendance ?? null }, ctx.columnsFor(c.setterId ?? ctx.defaultSetterId));
}

/** Last time anything happened in the conversation. */
export function lastActivity(c: ContactRow): string | null {
  return c.lastActivityAt ?? c.lastMessageAt ?? null;
}

export function matchesSearch(c: ContactRow, query: string): boolean {
  const q = query.trim().toLowerCase().replace(/^@/, "");
  if (!q) return true;
  return [c.username, c.fullName, c.email].some((v) => (v ?? "").toLowerCase().includes(q));
}

function activityOk(c: ContactRow, a: ActivityFilter, now: number): boolean {
  if (!a) return true;
  const at = lastActivity(c);
  const age = at ? now - Date.parse(at) : Infinity;
  const day = 86_400_000;
  if (a === "quiet30") return age >= 30 * day;
  const max = a === "24h" ? day : a === "7d" ? 7 * day : 30 * day;
  return age <= max;
}

export function filterRows(rows: ContactRow[], f: ViewFilters, query: string, ctx: QueryContext): ContactRow[] {
  const tagNames = f.tagIds.map((id) => ctx.tagNames.get(id)).filter((n): n is string => Boolean(n));
  // A tag id that no longer exists matches nobody (the view says so).
  const missingTag = tagNames.length < f.tagIds.length;
  return rows.filter(
    (c) =>
      !missingTag &&
      (f.archived ? Boolean(c.archivedAt) : !c.archivedAt) &&
      tagNames.every((t) => c.tags.includes(t)) &&
      (!f.stage || stageKeyOf(c, ctx) === f.stage) &&
      (!f.setter || onSetter(c, f.setter, ctx.defaultSetterId)) &&
      (!f.category || c.kind === f.category) &&
      (!f.source || sourceOf(c) === f.source) &&
      activityOk(c, f.activity, ctx.now) &&
      matchesSearch(c, query)
  );
}

/** The value a column sorts by. */
export function sortValue(c: ContactRow, key: string, ctx: QueryContext): string | number {
  switch (key) {
    case "name":
      return (c.username ?? c.fullName ?? "").toLowerCase();
    case "email":
      return (c.email ?? "").toLowerCase();
    case "stage": {
      const cols = ctx.columnsFor(c.setterId ?? ctx.defaultSetterId);
      return cols.findIndex((x) => x.key === stageKeyOf(c, ctx));
    }
    case "setter":
      return c.setterId ?? ctx.defaultSetterId ?? "";
    case "category":
      return c.kind;
    case "source":
      return sourceOf(c).toLowerCase();
    case "tags":
      return [...c.tags].sort().join(",");
    case "last":
      return Date.parse(lastActivity(c) ?? "") || 0;
    case "created":
      return Date.parse(c.createdAt ?? "") || 0;
    default:
      return key.startsWith("field:") ? (c.fields?.[key.slice(6)] ?? "").toLowerCase() : "";
  }
}

export function sortRows(rows: ContactRow[], sort: ViewSort, ctx: QueryContext): ContactRow[] {
  const dir = sort.dir === "asc" ? 1 : -1;
  const empty = (v: string | number) => v === "" || v === 0 || v === -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, sort.key, ctx);
    const vb = sortValue(b, sort.key, ctx);
    // Blanks always last, whichever way.
    if (empty(va) !== empty(vb)) return empty(va) ? 1 : -1;
    const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return cmp * dir || a.id.localeCompare(b.id);
  });
}

export interface QueryResult {
  rows: ContactRow[];
  total: number;
  page: number;
  pages: number;
}

/** Filter, search, sort, then one page of 50 (pages from 1; out of range clamps). */
export function queryContacts(rows: ContactRow[], view: ViewState, query: string, page: number, ctx: QueryContext): QueryResult {
  const sorted = sortRows(filterRows(rows, view.filters, query, ctx), view.sort, ctx);
  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), pages);
  return { rows: sorted.slice((p - 1) * PAGE_SIZE, p * PAGE_SIZE), total: sorted.length, page: p, pages };
}

/** A context from the setters on the page (each setter's funnel → its columns). */
export function queryContext(setters: { id: string; funnel?: { key: string; label: string }[]; isDefault?: boolean }[], tags: { id: string; name: string }[], now: number): QueryContext {
  const def = setters.find((s) => s.isDefault) ?? setters[0] ?? null;
  const cache = new Map<string, FunnelColumn[]>();
  return {
    now,
    tagNames: new Map(tags.map((t) => [t.id, t.name])),
    defaultSetterId: def?.id ?? null,
    columnsFor(id) {
      const key = id ?? "";
      let cols = cache.get(key);
      if (!cols) {
        cols = funnelColumns(setters.find((s) => s.id === id)?.funnel ?? def?.funnel ?? null);
        cache.set(key, cols);
      }
      return cols;
    },
  };
}
