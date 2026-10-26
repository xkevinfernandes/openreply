// OS_MOCK=1 samples for the Contacts table, Pipeline and Won picker
// (dm-crm issues 013, 017–020): saved views, two setters, J's offers, won
// amounts (the won event's data), created dates and a few custom field
// values. In memory on globalThis like the rest of the mock; gone on restart.

import type { WonDb } from "@/lib/os/events";
import { DEFAULT_FUNNEL } from "@/lib/os/funnel";
import { DEFAULT_COLUMNS, EMPTY_FILTERS, DEFAULT_SORT } from "@/lib/os/contacts-view";
import { memorySavedViews, type SavedViewRow, type SavedViewsDb } from "@/lib/os/saved-views";
import type { SetterOption } from "@/lib/os/contacts-board";

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

interface MockContactsCrm {
  views: SavedViewRow[];
  won: Map<string, { id: string; data: Record<string, unknown> }>;
  seq: number;
}

const WS = "mock-workspace";

function seedViews(): SavedViewRow[] {
  const view = (id: string, name: string, filters: Partial<typeof EMPTY_FILTERS>, isDefault = false, columns = DEFAULT_COLUMNS): SavedViewRow => ({
    id,
    workspaceId: WS,
    scope: "contacts",
    name,
    columns,
    filters: { ...EMPTY_FILTERS, ...filters },
    sort: DEFAULT_SORT,
    isDefault,
  });
  return [
    view("view-all", "All contacts", {}, true),
    view("view-hot", "Hot leads", { tagIds: ["tag-hot"] }),
    view("view-agency", "Agencies", { tagIds: ["tag-agency"] }, false, ["name", "email", "field:business", "stage", "tags", "last"]),
    view("view-archived", "Archived", { archived: true }),
  ];
}

function seedWon(): Map<string, { id: string; data: Record<string, unknown> }> {
  // Nora (c9) is on Won with the Accelerator.
  return new Map([["won:c9", { id: "ev-won-c9", data: { offer: "Accelerator", amount: 3600, wonAt: daysAgo(8) } }]]);
}

const mem: MockContactsCrm = ((globalThis as { __osMockContactsCrm?: MockContactsCrm }).__osMockContactsCrm ??= {
  views: seedViews(),
  won: seedWon(),
  seq: 0,
});

/** Saved views for every mock workspace (the mock has one). */
export function mockSavedViews(): SavedViewsDb {
  const inner = memorySavedViews(mem.views);
  // The sample rows belong to "mock-workspace"; serve them to whichever id the mock session has.
  const ws = (id: string) => {
    for (const r of mem.views) if (r.workspaceId === WS) r.workspaceId = id;
    return id;
  };
  return {
    list: (w, s) => inner.list(ws(w), s),
    create: (row) => inner.create({ ...row, workspaceId: ws(row.workspaceId) }),
    update: (w, id, d) => inner.update(ws(w), id, d),
    remove: (w, id) => inner.remove(ws(w), id),
    setDefault: (w, s, id) => inner.setDefault(ws(w), s, id),
  };
}

// --- Setters and offers -----------------------------------------------------------

export const MOCK_SETTERS: SetterOption[] = [
  { id: "setter-j", name: "J", funnel: DEFAULT_FUNNEL, isDefault: true },
  {
    id: "setter-post",
    name: "Post-call",
    funnel: [
      { key: "recap", label: "Recap" },
      { key: "decision", label: "Decision" },
      { key: "nurture", label: "Nurture" },
    ],
    isDefault: false,
  },
];

/** J's structured offers (Setter.offers), as Knowledge bases stores them. */
export const MOCK_OFFERS = [
  { name: "Accelerator", status: "open", sold_by: "call", price: "€3,600", length: "8 weeks, group" },
  { name: "1:1 Mentorship", status: "open", sold_by: "call", price: "€6,000", length: "3 months" },
  { name: "DM setup", status: "open", sold_by: "call", price: "1500", length: "Done for you" },
];

// --- Won data (the won event's data) ---------------------------------------------

export function mockWonDb(): WonDb {
  return {
    osEvent: {
      async findUnique({ where }) {
        const r = mem.won.get(where.dedupeKey);
        return r ? { id: r.id, data: { ...r.data } } : null;
      },
      async create({ data }) {
        const d = data as { dedupeKey: string; data: Record<string, unknown> };
        mem.won.set(d.dedupeKey, { id: `ev${++mem.seq}`, data: { ...d.data } });
        return d;
      },
      async update({ where, data }) {
        for (const r of mem.won.values()) if (r.id === where.id) r.data = { ...(data.data as Record<string, unknown>) };
        return null;
      },
    },
  };
}

export function mockWonData(contactId: string): Record<string, unknown> | null {
  return mem.won.get(`won:${contactId}`)?.data ?? null;
}

/** The stage writer's mock clears won data here (lib/os/stage-writer-mock.ts). */
export function mockClearWon(contactId: string) {
  const r = mem.won.get(`won:${contactId}`);
  if (!r) return;
  delete r.data.amount;
  delete r.data.offer;
  delete r.data.wonAt;
}

// --- Table extras on the sample contacts -----------------------------------------

const CREATED: Record<string, number> = { c1: 3, c2: 6, c3: 12, c4: 40, c5: 1, c6: 18, c7: 2, c8: 9, c9: 55, c10: 30, c11: 14, c12: 4 };

const FIELDS: Record<string, Record<string, string>> = {
  c1: { business: "Notion template shop", phone: "+352 621 000 111" },
  c3: { business: "Ops agency" },
  c6: { business: "Fitness studio", phone: "+44 7700 900123" },
  c8: { business: "Growth agency" },
  c9: { business: "Coaching", phone: "+1 415 555 0134" },
  c12: { business: "Brand studio" },
};

export function mockRowExtras(contactId: string): { createdAt: string; fields: Record<string, string> } {
  return { createdAt: daysAgo(CREATED[contactId] ?? 7), fields: { ...(FIELDS[contactId] ?? {}) } };
}

/** Custom fields shown as columns when the database has none (OS_MOCK). */
export const MOCK_FIELD_COLUMNS = [
  { key: "phone", label: "Phone" },
  { key: "business", label: "Business name" },
];
