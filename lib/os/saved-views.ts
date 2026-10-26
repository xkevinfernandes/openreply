// Saved Contacts views shared by the workspace (dm-crm issue 018, SavedView).
// Exactly one default per workspace: the first read creates "All contacts"
// as the default; Set default moves the flag in one transaction; the default
// can't be deleted (pick another default first). Tag filters store tag ids,
// so a rename shows the new name.

import { prisma } from "@/lib/db/client";
import { DEFAULT_VIEW, parseViewState, type ViewState } from "@/lib/os/contacts-view";
import { osMockEnabled } from "@/lib/os/mock";
import { mockSavedViews } from "@/lib/os/mock-contacts-crm";

export const VIEW_SCOPE = "contacts";
export const DEFAULT_VIEW_NAME = "All contacts";
const NAME_MAX = 40;
const VIEWS_MAX = 50;

export interface SavedViewRecord {
  id: string;
  name: string;
  isDefault: boolean;
  state: ViewState;
}

export interface SavedViewRow {
  id: string;
  workspaceId: string;
  scope: string;
  name: string;
  columns: unknown;
  filters: unknown;
  sort: unknown;
  isDefault: boolean;
}

/** Storage port (Prisma, the OS_MOCK store and test fakes). */
export interface SavedViewsDb {
  list(workspaceId: string, scope: string): Promise<SavedViewRow[]>;
  create(row: Omit<SavedViewRow, "id">): Promise<SavedViewRow>;
  update(workspaceId: string, id: string, data: Partial<Pick<SavedViewRow, "name" | "columns" | "filters" | "sort">>): Promise<SavedViewRow | null>;
  remove(workspaceId: string, id: string): Promise<boolean>;
  /** Makes `id` the only default of the scope, atomically. */
  setDefault(workspaceId: string, scope: string, id: string): Promise<boolean>;
}

export type ViewResult = { ok: true; view: SavedViewRecord } | { ok: false; error: string };

export function viewRecord(r: SavedViewRow): SavedViewRecord {
  return { id: r.id, name: r.name, isDefault: r.isDefault, state: parseViewState(r.columns, r.filters, r.sort) };
}

function cleanName(raw: unknown): string {
  return typeof raw === "string" ? raw.trim().replace(/\s+/g, " ").slice(0, NAME_MAX) : "";
}

function stored(state: ViewState) {
  const s = parseViewState(state?.columns, state?.filters, state?.sort);
  return { columns: s.columns, filters: s.filters, sort: s.sort };
}

/** Defaults first, then by name. Creates the default view on first read and
 *  repairs a workspace with no (or several) defaults. */
export async function listViews(workspaceId: string, db: SavedViewsDb = defaultDb()): Promise<SavedViewRecord[]> {
  let rows = await db.list(workspaceId, VIEW_SCOPE);
  if (!rows.length) {
    rows = [await db.create({ workspaceId, scope: VIEW_SCOPE, name: DEFAULT_VIEW_NAME, ...stored(DEFAULT_VIEW), isDefault: true })];
  }
  const defaults = rows.filter((r) => r.isDefault);
  if (defaults.length !== 1) {
    const keep = defaults[0] ?? rows.find((r) => r.name === DEFAULT_VIEW_NAME) ?? rows[0];
    await db.setDefault(workspaceId, VIEW_SCOPE, keep.id);
    rows = rows.map((r) => ({ ...r, isDefault: r.id === keep.id }));
  }
  return rows.map(viewRecord).sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** "Save for everyone": overwrites the open view's columns, filters and sort. */
export async function saveView(workspaceId: string, id: string, state: ViewState, db: SavedViewsDb = defaultDb()): Promise<ViewResult> {
  const r = await db.update(workspaceId, id, stored(state));
  return r ? { ok: true, view: viewRecord(r) } : { ok: false, error: "That view is gone. Refresh." };
}

/** "Save as": a new view with this state. */
export async function saveViewAs(workspaceId: string, name: unknown, state: ViewState, db: SavedViewsDb = defaultDb()): Promise<ViewResult> {
  const n = cleanName(name);
  if (!n) return { ok: false, error: "Name the view." };
  const rows = await db.list(workspaceId, VIEW_SCOPE);
  if (rows.some((r) => r.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: `There's already a view called ${n}.` };
  if (rows.length >= VIEWS_MAX) return { ok: false, error: `Keep it to ${VIEWS_MAX} views.` };
  const r = await db.create({ workspaceId, scope: VIEW_SCOPE, name: n, ...stored(state), isDefault: rows.length === 0 });
  return { ok: true, view: viewRecord(r) };
}

export async function renameView(workspaceId: string, id: string, name: unknown, db: SavedViewsDb = defaultDb()): Promise<ViewResult> {
  const n = cleanName(name);
  if (!n) return { ok: false, error: "Name the view." };
  const rows = await db.list(workspaceId, VIEW_SCOPE);
  if (rows.some((r) => r.id !== id && r.name.toLowerCase() === n.toLowerCase())) return { ok: false, error: `There's already a view called ${n}.` };
  const r = await db.update(workspaceId, id, { name: n });
  return r ? { ok: true, view: viewRecord(r) } : { ok: false, error: "That view is gone. Refresh." };
}

/** The default can't be deleted. */
export async function deleteView(workspaceId: string, id: string, db: SavedViewsDb = defaultDb()): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = (await db.list(workspaceId, VIEW_SCOPE)).find((r) => r.id === id);
  if (!row) return { ok: false, error: "That view is gone. Refresh." };
  if (row.isDefault) return { ok: false, error: "That's the default view. Make another view the default first." };
  await db.remove(workspaceId, id);
  return { ok: true };
}

export async function setDefaultView(workspaceId: string, id: string, db: SavedViewsDb = defaultDb()): Promise<{ ok: true } | { ok: false; error: string }> {
  const done = await db.setDefault(workspaceId, VIEW_SCOPE, id);
  return done ? { ok: true } : { ok: false, error: "That view is gone. Refresh." };
}

// --- Prisma ---------------------------------------------------------------------

type J = object;

export const prismaSavedViews: SavedViewsDb = {
  list: (workspaceId, scope) => prisma.savedView.findMany({ where: { workspaceId, scope }, orderBy: { createdAt: "asc" } }),
  create: (row) => prisma.savedView.create({ data: { ...row, columns: row.columns as J, filters: row.filters as J, sort: row.sort as J } }),
  async update(workspaceId, id, data) {
    const r = await prisma.savedView.updateMany({ where: { id, workspaceId }, data: data as Record<string, J> });
    return r.count ? prisma.savedView.findFirst({ where: { id, workspaceId } }) : null;
  },
  async remove(workspaceId, id) {
    return (await prisma.savedView.deleteMany({ where: { id, workspaceId, isDefault: false } })).count > 0;
  },
  async setDefault(workspaceId, scope, id) {
    return prisma.$transaction(async (tx) => {
      const hit = await tx.savedView.findFirst({ where: { id, workspaceId, scope }, select: { id: true } });
      if (!hit) return false;
      await tx.savedView.updateMany({ where: { workspaceId, scope, isDefault: true, NOT: { id } }, data: { isDefault: false } });
      await tx.savedView.updateMany({ where: { id, workspaceId }, data: { isDefault: true } });
      return true;
    });
  },
};

/** An in-memory store (OS_MOCK and tests). */
export function memorySavedViews(rows: SavedViewRow[] = []): SavedViewsDb {
  let seq = rows.length;
  return {
    async list(workspaceId, scope) {
      return rows.filter((r) => r.workspaceId === workspaceId && r.scope === scope).map((r) => ({ ...r }));
    },
    async create(row) {
      const r = { ...row, id: `view${++seq}` };
      rows.push(r);
      return { ...r };
    },
    async update(workspaceId, id, data) {
      const r = rows.find((x) => x.id === id && x.workspaceId === workspaceId);
      if (!r) return null;
      Object.assign(r, data);
      return { ...r };
    },
    async remove(workspaceId, id) {
      const i = rows.findIndex((x) => x.id === id && x.workspaceId === workspaceId && !x.isDefault);
      if (i < 0) return false;
      rows.splice(i, 1);
      return true;
    },
    async setDefault(workspaceId, scope, id) {
      if (!rows.some((r) => r.id === id && r.workspaceId === workspaceId && r.scope === scope)) return false;
      for (const r of rows) if (r.workspaceId === workspaceId && r.scope === scope) r.isDefault = r.id === id;
      return true;
    },
  };
}

function defaultDb(): SavedViewsDb {
  return osMockEnabled() ? mockSavedViews() : prismaSavedViews;
}
