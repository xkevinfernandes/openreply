// dm-crm 013, 017–020: Won picker, contacts query layer, saved views,
// Pipeline drop targets and Undo Won.
import { describe, expect, it } from "vitest";
import type { ContactRow, SetterOption } from "../../lib/os/contacts-board";
import { planChange } from "../../lib/os/contacts-edit";
import { DEFAULT_VIEW, EMPTY_FILTERS, PAGE_SIZE, parseViewState, queryContacts, queryContext, sameView, type ViewState } from "../../lib/os/contacts-view";
import type { WonDb } from "../../lib/os/events";
import { funnelColumns } from "../../lib/os/funnel";
import { allowedKeys, boardLanes, boardRedirect, cardTargets, moveLocally, pickSetter, selectionTargets } from "../../lib/os/pipeline-board";
import { deleteView, listViews, memorySavedViews, saveView, saveViewAs, setDefaultView } from "../../lib/os/saved-views";
import type { StageWriteResult, writeStage } from "../../lib/os/stage-writer";
import { decideMove } from "../../lib/os/move-table";
import { markWon, undoWon } from "../../lib/os/won";
import { offersFromSetter, parsePrice, validateWonChoice } from "../../lib/os/won-offers";

const row = (over: Partial<ContactRow>): ContactRow => ({
  id: "c",
  username: null,
  fullName: null,
  avatarUrl: null,
  kind: "SALES",
  stage: "IN_CONVERSATION",
  setterStage: null,
  entryPath: null,
  tags: [],
  paused: false,
  onFriday: false,
  notes: null,
  email: null,
  lastMessageAt: null,
  zernioConversationId: null,
  setterId: null,
  draftWaiting: false,
  ...over,
});

const columns = funnelColumns(null);
const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (h: number) => new Date(NOW - h * 3600_000).toISOString();

// --- Won picker ------------------------------------------------------------------

describe("won picker", () => {
  it("parses prices", () => {
    expect(parsePrice("€3,600")).toBe(3600);
    expect(parsePrice("2.000 EUR")).toBe(2000);
    expect(parsePrice("$1.5k")).toBe(1500);
    expect(parsePrice("1500")).toBe(1500);
    expect(parsePrice("on the call")).toBeNull();
  });

  it("reads the structured offer list, never Markdown, skipping closed offers", () => {
    const offers = offersFromSetter([
      { name: "Accelerator", price: "€3,600", length: "8 weeks", status: "open" },
      { name: "Old", price: "100", status: "closed" },
      { name: "No price", status: "open" },
      "## Offers markdown",
    ]);
    expect(offers).toEqual([
      { name: "Accelerator", sub: "8 weeks", price: 3600 },
      { name: "No price", sub: null, price: null },
    ]);
    expect(offersFromSetter("# offers.md")).toEqual([]);
  });

  it("needs an offer and an amount", () => {
    expect(validateWonChoice({ offer: " ", amount: 10 })).toEqual({ error: "Pick or type the offer." });
    expect(validateWonChoice({ offer: "Typed", amount: "" })).toEqual({ error: "Type the amount." });
    expect(validateWonChoice({ offer: " DM  setup ", amount: "1,500" })).toEqual({ offer: "DM setup", amount: 1500 });
  });
});

function fakeWon(seed: Record<string, Record<string, unknown>> = {}) {
  const rows = new Map(Object.entries(seed).map(([k, data], i) => [k, { id: `e${i}`, data }]));
  const db: WonDb = {
    osEvent: {
      async findUnique({ where }) {
        const r = rows.get(where.dedupeKey);
        return r ? { id: r.id, data: r.data } : null;
      },
      async create({ data }) {
        const d = data as { dedupeKey: string; data: Record<string, unknown> };
        rows.set(d.dedupeKey, { id: `new-${d.dedupeKey}`, data: d.data });
        return d;
      },
      async update({ where, data }) {
        for (const r of rows.values()) if (r.id === where.id) r.data = data.data as Record<string, unknown>;
        return null;
      },
    },
  };
  return { db, rows };
}

function fakeWriter(results: Record<string, StageWriteResult>) {
  const calls: Parameters<typeof writeStage>[0][] = [];
  const write = (async (input: Parameters<typeof writeStage>[0]) => {
    calls.push(input);
    return results[input.contactId] ?? { status: "applied", from: "open", to: "won", stage: "WON", logged: true };
  }) as typeof writeStage;
  return { write, calls };
}

describe("marking Won", () => {
  it("moves through the stage writer as the user, then stores offer, amount and wonAt (event created if missing, data added if present)", async () => {
    const { db, rows } = fakeWon({ "won:a": { source: "hook" } });
    const { write, calls } = fakeWriter({});
    const r = await markWon("ws", ["a", "b"], { offer: "Accelerator", amount: 3600 }, { won: db, write });
    expect(r).toEqual({ count: 2, refused: [] });
    expect(calls.map((c) => [c.contactId, c.cause, c.change])).toEqual([
      ["a", "user", { type: "column", column: "won" }],
      ["b", "user", { type: "column", column: "won" }],
    ]);
    expect(rows.get("won:a")?.data).toMatchObject({ source: "hook", offer: "Accelerator", amount: 3600 });
    expect(rows.get("won:b")?.data).toMatchObject({ offer: "Accelerator", amount: 3600 });
    expect(typeof rows.get("won:b")?.data.wonAt).toBe("string");
  });

  it("skips refused contacts and says why when none moved", async () => {
    const { db, rows } = fakeWon();
    const { write } = fakeWriter({ a: { status: "refused", from: "booked", to: "won", reason: "Nope." } });
    expect(await markWon("ws", ["a"], { offer: "X", amount: 1 }, { won: db, write })).toEqual({ error: "Nope." });
    expect(rows.size).toBe(0);
    expect(await markWon("ws", ["a"], { offer: "", amount: 1 }, { won: db, write })).toEqual({ error: "Pick or type the offer." });
  });

  it("Undo Won is the writer's user operation", async () => {
    const { write, calls } = fakeWriter({ b: { status: "refused", from: "open", to: "open", reason: "They aren't on Won." } });
    expect(await undoWon("ws", "a", { write })).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ cause: "user", change: { type: "undoWon" } });
    expect(await undoWon("ws", "b", { write })).toEqual({ error: "They aren't on Won." });
  });

  it("Undo Won lands on Booked with a live booking, else in conversation, even with attendance", () => {
    const base = { stage: "WON" as const, setterStage: "qualify", setterId: null, columns };
    const booked = decideMove({ ...base, attendance: "SHOWED", liveBooking: true }, { type: "undoWon" }, "user");
    expect(booked).toMatchObject({ kind: "apply", data: { stage: "CALL_BOOKED" }, clearWon: true });
    const none = decideMove({ ...base, attendance: null, liveBooking: false }, { type: "undoWon" }, "user");
    expect(none).toMatchObject({ kind: "apply", data: { stage: "IN_CONVERSATION" }, to: "qualify", clearWon: true });
  });
});

// --- Contacts query layer ------------------------------------------------------------

const setters: SetterOption[] = [
  { id: "s1", name: "J", isDefault: true },
  { id: "s2", name: "Post", funnel: [{ key: "recap", label: "Recap" }] },
];
const tags = [
  { id: "t-hot", name: "hot" },
  { id: "t-agency", name: "agency" },
];

const people: ContactRow[] = [
  row({ id: "a", username: "maya", email: "maya@x.co", tags: ["hot"], setterStage: "qualify", lastActivityAt: ago(1), createdAt: ago(100) }),
  row({ id: "b", username: "tom", tags: ["hot", "agency"], lastActivityAt: ago(30), createdAt: ago(10) }),
  row({ id: "c", username: "old", stage: "WON", lastActivityAt: ago(24 * 40), createdAt: ago(2000), archivedAt: ago(5) }),
  row({ id: "d", username: "post.person", setterId: "s2", kind: "PERSONAL", lastActivityAt: ago(5), createdAt: ago(50), fields: { business: "Studio" } }),
];

const ctx = queryContext(setters, tags, NOW);
const view = (filters: Partial<ViewState["filters"]> = {}, sort = DEFAULT_VIEW.sort): ViewState => ({ ...DEFAULT_VIEW, filters: { ...EMPTY_FILTERS, ...filters }, sort });
const ids = (v: ViewState, q = "", page = 1) => queryContacts(people, v, q, page, ctx).rows.map((r) => r.id);

describe("contacts query layer", () => {
  it("hides archived by default; the Archived filter shows only them", () => {
    expect(ids(view())).toEqual(["a", "d", "b"]);
    expect(ids(view({ archived: true }))).toEqual(["c"]);
  });

  it("filters by tag ids (all must match), and a rename keeps the filter", () => {
    expect(ids(view({ tagIds: ["t-hot", "t-agency"] }))).toEqual(["b"]);
    const renamed = queryContext(setters, [{ id: "t-hot", name: "warm" }], NOW);
    const rows = people.map((p) => ({ ...p, tags: p.tags.map((t) => (t === "hot" ? "warm" : t)) }));
    expect(queryContacts(rows, view({ tagIds: ["t-hot"] }), "", 1, renamed).rows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(ids(view({ tagIds: ["gone"] }))).toEqual([]);
  });

  it("filters by stage column, setter (none = default), category, last activity", () => {
    expect(ids(view({ stage: "qualify" }))).toEqual(["a"]);
    expect(ids(view({ setter: "s1" }))).toEqual(["a", "b"]);
    expect(ids(view({ setter: "s2" }))).toEqual(["d"]);
    expect(ids(view({ category: "PERSONAL" }))).toEqual(["d"]);
    expect(ids(view({ activity: "24h" }))).toEqual(["a", "d"]);
    expect(ids(view({ activity: "quiet30", archived: true }))).toEqual(["c"]);
  });

  it("searches name, username and email", () => {
    expect(ids(view(), "@MAYA")).toEqual(["a"]);
    expect(ids(view(), "x.co")).toEqual(["a"]);
  });

  it("sorts by any column, blanks last", () => {
    expect(ids(view({}, { key: "name", dir: "asc" }))).toEqual(["a", "d", "b"]);
    expect(ids(view({}, { key: "created", dir: "desc" }))).toEqual(["b", "d", "a"]);
    expect(ids(view({}, { key: "field:business", dir: "asc" }))).toEqual(["d", "a", "b"]);
  });

  it("pages by 50 and clamps", () => {
    const many = Array.from({ length: 120 }, (_, i) => row({ id: `p${String(i).padStart(3, "0")}`, username: `u${i}` }));
    const r = queryContacts(many, view({}, { key: "name", dir: "asc" }), "", 3, ctx);
    expect([r.total, r.pages, r.page, r.rows.length]).toEqual([120, 3, 3, 120 - 2 * PAGE_SIZE]);
    expect(queryContacts(many, view(), "", 99, ctx).page).toBe(3);
  });

  it("parses stored views and spots edits", () => {
    const v = parseViewState(["email"], { tagIds: ["a", 3], archived: true, category: "NOPE" }, { key: "email", dir: "asc" });
    expect(v.columns).toEqual(["name", "email"]);
    expect(v.filters).toMatchObject({ tagIds: ["a"], archived: true, category: "" });
    expect(sameView(v, { ...v, filters: { ...v.filters } })).toBe(true);
    expect(sameView(v, { ...v, sort: { key: "email", dir: "desc" } })).toBe(false);
  });
});

// --- Saved views ------------------------------------------------------------------

describe("saved views", () => {
  it("creates one default on first read and keeps exactly one", async () => {
    const db = memorySavedViews();
    const first = await listViews("ws", db);
    expect(first.map((v) => [v.name, v.isDefault])).toEqual([["All contacts", true]]);
    const hot = await saveViewAs("ws", "Hot", view({ tagIds: ["t-hot"] }), db);
    expect(hot.ok).toBe(true);
    if (!hot.ok) return;
    expect((await saveViewAs("ws", "hot", DEFAULT_VIEW, db)).ok).toBe(false);
    await setDefaultView("ws", hot.view.id, db);
    const after = await listViews("ws", db);
    expect(after.filter((v) => v.isDefault).map((v) => v.name)).toEqual(["Hot"]);
    expect(after[0].state.filters.tagIds).toEqual(["t-hot"]);
  });

  it("refuses to delete the default; deletes others; scoped to the workspace", async () => {
    const db = memorySavedViews();
    const [all] = await listViews("ws", db);
    expect(await deleteView("ws", all.id, db)).toEqual({ ok: false, error: "That's the default view. Make another view the default first." });
    const other = await saveViewAs("ws", "Other", DEFAULT_VIEW, db);
    if (!other.ok) throw new Error();
    expect(await deleteView("ws2", other.view.id, db)).toMatchObject({ ok: false });
    expect(await deleteView("ws", other.view.id, db)).toEqual({ ok: true });
    expect((await listViews("ws", db)).length).toBe(1);
  });

  it("Save overwrites the open view; a workspace with two defaults is repaired", async () => {
    const db = memorySavedViews([
      { id: "x", workspaceId: "ws", scope: "contacts", name: "A", columns: [], filters: {}, sort: {}, isDefault: true },
      { id: "y", workspaceId: "ws", scope: "contacts", name: "B", columns: [], filters: {}, sort: {}, isDefault: true },
    ]);
    expect((await listViews("ws", db)).filter((v) => v.isDefault).length).toBe(1);
    const r = await saveView("ws", "y", view({ archived: true }), db);
    expect(r.ok && r.view.state.filters.archived).toBe(true);
  });
});

// --- Pipeline ---------------------------------------------------------------------

describe("pipeline board", () => {
  it("offers exactly the move table's allowed targets", () => {
    const open = row({ id: "o", setterStage: "open" });
    const t = cardTargets(open, columns);
    expect(t.find((x) => x.key === "open")).toMatchObject({ allowed: false, reason: "Here now" });
    expect([...allowedKeys(open, columns)]).toEqual(["value", "permission", "qualify", "assure", "book", "won", "lost"]);
    const booked = row({ id: "b", stage: "CALL_BOOKED", booking: { start: ago(-24), timezone: "UTC", hostTimezone: "UTC", status: "CONFIRMED", email: "x@y.z" } });
    expect([...allowedKeys(booked, columns)]).toEqual(["won", "lost"]);
    expect(t.find((x) => x.key === "showed")).toMatchObject({ allowed: false, reason: "Set from the booking." });
  });

  it("several cards go to Won or Lost only; one card gets its own targets", () => {
    const a = row({ id: "a", setterStage: "open" });
    const b = row({ id: "b", setterStage: "qualify" });
    expect(selectionTargets([a, b], columns).map((t) => [t.key, t.allowed])).toEqual([
      ["won", true],
      ["lost", true],
    ]);
    expect(selectionTargets([a], columns)).toEqual(cardTargets(a, columns));
  });

  it("counts per column, Won total and cards with no amount", () => {
    const lanes = boardLanes(
      [row({ id: "1", setterStage: "open" }), row({ id: "2", stage: "WON", won: { offer: "A", amount: 3600 } }), row({ id: "3", stage: "WON" }), row({ id: "4", stage: "LOST" })],
      columns
    );
    const by = Object.fromEntries(lanes.map((l) => [l.column.key, l]));
    expect(by.open.cards.length).toBe(1);
    expect([by.won.cards.length, by.won.total, by.won.noAmount]).toEqual([2, 3600, 1]);
    expect(by.lost.cards.length).toBe(1);
    expect(by.booked.total).toBeNull();
  });

  it("moves locally like the writer", () => {
    expect(moveLocally(row({ stage: "LOST" }), "qualify", columns)).toMatchObject({ stage: "IN_CONVERSATION", setterStage: "qualify" });
    expect(moveLocally(row({ stage: "WON", won: { offer: "x", amount: 1 } }), "lost", columns)).toMatchObject({ stage: "LOST", won: null });
  });

  it("picks the setter: ?setter=, else the default; old board links redirect", () => {
    expect(pickSetter(setters, "s2")).toBe("s2");
    expect(pickSetter(setters, "nope")).toBe("s1");
    expect(boardRedirect({})).toBeNull();
    expect(boardRedirect({ view: "table" })).toBeNull();
    expect(boardRedirect({ view: "kanban" })).toBe("/os/pipeline");
    expect(boardRedirect({ stage: "won", setter: "s2", contact: "c1" })).toBe("/os/pipeline?setter=s2&stage=won&c=c1");
  });

  it("board moves and archive plan correctly; Won only through the picker", () => {
    expect(planChange({ type: "column", column: "lost" })).toEqual({ data: { column: "lost" } });
    expect(planChange({ type: "column", column: "won" })).toEqual({ error: "Mark Won from the Won picker." });
    const a = planChange({ type: "archive", archived: true });
    expect("data" in a && a.data.archivedAt instanceof Date).toBe(true);
    expect(planChange({ type: "archive", archived: false })).toEqual({ data: { archivedAt: null } });
  });
});
