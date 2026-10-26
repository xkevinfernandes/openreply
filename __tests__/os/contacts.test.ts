import { describe, expect, it } from "vitest";
import type { ContactRow } from "../../lib/os/contacts-board";
import { editContacts, planChange, type ContactsEditDb } from "../../lib/os/contacts-edit";
import {
  activeFilterCount,
  allTags,
  applyChangeLocally,
  emptyFilters,
  entryKey,
  filterContacts,
  groupByStage,
  parseEmail,
  stepStage,
} from "../../lib/os/contacts-filter";
import { stageOrder } from "../../lib/os/labels";

const row = (over: Partial<ContactRow>): ContactRow => ({
  id: "c",
  username: null,
  fullName: null,
  avatarUrl: null,
  kind: "SALES",
  stage: "NEW",
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

const rows = [
  row({ id: "a", username: "maya.builds", stage: "QUALIFIED", entryPath: "comment", tags: ["hot"] }),
  row({ id: "b", username: "tom", stage: "NEW", entryPath: "setter_comment", setterId: "s1" }),
  row({ id: "c", username: "alex", kind: "PERSONAL", tags: ["friend"] }),
  row({ id: "d", fullName: "Priya", kind: "UNSORTED", email: "priya@studio.co" }),
];

describe("contacts filters", () => {
  it("shows only Sales by default, everyone on 'all', one kind with a kind filter", () => {
    expect(filterContacts(rows, emptyFilters).map((c) => c.id)).toEqual(["a", "b"]);
    expect(filterContacts(rows, { ...emptyFilters, scope: "all" })).toHaveLength(4);
    expect(filterContacts(rows, { ...emptyFilters, scope: "all", kind: "PERSONAL" }).map((c) => c.id)).toEqual(["c"]);
    // the kind filter means nothing while scope is sales
    expect(filterContacts(rows, { ...emptyFilters, kind: "PERSONAL" }).map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("filters by stage, entry (setter_comment counts as comment), setter, tag and search", () => {
    expect(filterContacts(rows, { ...emptyFilters, stage: "QUALIFIED" }).map((c) => c.id)).toEqual(["a"]);
    expect(entryKey("setter_comment")).toBe("comment");
    expect(entryKey(null)).toBe("none");
    expect(filterContacts(rows, { ...emptyFilters, entry: "comment" })).toHaveLength(2);
    expect(filterContacts(rows, { ...emptyFilters, setter: "default" }).map((c) => c.id)).toEqual(["a"]);
    expect(filterContacts(rows, { ...emptyFilters, setter: "s1" }).map((c) => c.id)).toEqual(["b"]);
    expect(filterContacts(rows, { ...emptyFilters, tag: "hot" }).map((c) => c.id)).toEqual(["a"]);
    expect(filterContacts(rows, { ...emptyFilters, query: "@MAYA" }).map((c) => c.id)).toEqual(["a"]);
    expect(filterContacts(rows, { ...emptyFilters, scope: "all", query: "studio.co" }).map((c) => c.id)).toEqual(["d"]);
  });

  it("counts active panel filters", () => {
    expect(activeFilterCount(emptyFilters)).toBe(0);
    expect(activeFilterCount({ ...emptyFilters, kind: "PERSONAL" })).toBe(0);
    expect(activeFilterCount({ ...emptyFilters, scope: "all", kind: "PERSONAL", tag: "x", query: "q" })).toBe(2);
  });

  it("groups into every Kanban column in order, Not qualified its own", () => {
    const g = groupByStage(rows);
    expect(Object.keys(g)).toEqual(stageOrder);
    expect(g.NOT_QUALIFIED).toEqual([]);
    expect(g.QUALIFIED.map((c) => c.id)).toEqual(["a"]);
    expect(stepStage("NEW", -1)).toBeNull();
    expect(stepStage("NEW", 1)).toBe("LEAD_MAGNET_SENT");
    expect(stepStage("LOST", 1)).toBeNull();
  });

  it("collects tags and applies a change locally", () => {
    expect(allTags(rows)).toEqual(["friend", "hot"]);
    const next = applyChangeLocally(rows, ["a", "b"], { type: "addTag", tag: " Hot " });
    expect(next.find((c) => c.id === "a")!.tags).toEqual(["hot"]);
    expect(next.find((c) => c.id === "b")!.tags).toEqual(["hot"]);
    expect(next.find((c) => c.id === "c")).toBe(rows[2]);
    expect(applyChangeLocally(rows, ["a"], { type: "stage", stage: "WON" })[0].stage).toBe("WON");
  });

  it("validates email", () => {
    expect(parseEmail("  a@b.co ")).toEqual({ email: "a@b.co" });
    expect(parseEmail("")).toEqual({ email: null });
    expect("error" in parseEmail("nope")).toBe(true);
  });
});

describe("contact edits", () => {
  function fakeDb(tags: Record<string, string[]> = {}) {
    const calls: { op: string; where: Record<string, unknown>; data?: Record<string, unknown> }[] = [];
    const db: ContactsEditDb = {
      contact: {
        updateMany: async ({ where, data }) => {
          calls.push({ op: "updateMany", where, data });
          return { count: Array.isArray((where.id as { in?: string[] })?.in) ? (where.id as { in: string[] }).in.length : 1 };
        },
        findMany: async ({ where }) => {
          calls.push({ op: "findMany", where });
          const ids = (where.id as { in?: string[] })?.in;
          const known = Object.keys(tags).length ? Object.entries(tags) : (ids ?? []).filter((id) => id !== "foreign").map((id) => [id, [] as string[]] as const);
          return known.map(([id, t]) => ({ id, tags: [...t] }));
        },
      },
    };
    const fired: { workspaceId: string; contactId: string; event: string }[] = [];
    const fire = async (e: { workspaceId: string; contactId: string; event: string }) => {
      fired.push(e);
    };
    return { db, calls, fire, fired };
  }

  it("scopes every write to the workspace and syncs only this workspace's contacts", async () => {
    const { db, calls, fire, fired } = fakeDb();
    // Stage changes go through the one stage writer, one contact at a time.
    const writes: { contactId: string; cause: string; change: unknown }[] = [];
    const write = (async (input: { contactId: string; cause: string; change: unknown }) => {
      writes.push({ contactId: input.contactId, cause: input.cause, change: input.change });
      return { status: "applied", from: "open", to: "qualify", stage: "QUALIFIED", logged: true };
    }) as unknown as Parameters<typeof editContacts>[6];
    expect(await editContacts("w1", ["a", "b", "a", "foreign"], { type: "stage", stage: "QUALIFIED" }, db, fire, null, write)).toEqual({ count: 2 });
    expect(calls[0]).toMatchObject({ op: "findMany", where: { id: { in: ["a", "b", "foreign"] }, workspaceId: "w1" } });
    expect(writes).toEqual([
      { contactId: "a", cause: "user", change: { type: "stage", stage: "QUALIFIED" } },
      { contactId: "b", cause: "user", change: { type: "stage", stage: "QUALIFIED" } },
    ]);
    expect(fired).toEqual([
      { workspaceId: "w1", contactId: "a", event: "stage_changed" },
      { workspaceId: "w1", contactId: "b", event: "stage_changed" },
    ]);
  });

  it("pause and notes stay local; kind, tags and email go to the CRMs", async () => {
    const pause = fakeDb();
    await editContacts("w1", ["a"], { type: "paused", paused: true }, pause.db, pause.fire);
    expect(pause.fired).toEqual([]);
    expect(pause.calls.map((c) => c.op)).toEqual(["updateMany"]);
    const kind = fakeDb();
    await editContacts("w1", ["a"], { type: "kind", kind: "SALES" }, kind.db, kind.fire);
    expect(kind.fired[0].event).toBe("kind_changed");
    const tag = fakeDb({ a: [] });
    await editContacts("w1", ["a"], { type: "addTag", tag: "hot" }, tag.db, tag.fire);
    expect(tag.fired).toEqual([{ workspaceId: "w1", contactId: "a", event: "tags_changed" }]);
    const email = fakeDb();
    await editContacts("w1", ["a"], { type: "details", email: "a@b.co" }, email.db, email.fire);
    expect(email.fired[0].event).toBe("manual");
  });

  it("a kind change is the user's decision and clears J's suggestion", () => {
    expect(planChange({ type: "kind", kind: "PERSONAL" })).toEqual({
      data: { kind: "PERSONAL", kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null },
    });
  });

  it("adds and removes tags per row, workspace-scoped", async () => {
    const add = fakeDb({ a: ["old"] });
    expect(await editContacts("w1", ["a"], { type: "addTag", tag: "Hot" }, add.db, add.fire)).toEqual({ count: 1 });
    expect(add.calls[0].where).toMatchObject({ workspaceId: "w1", NOT: { tags: { has: "hot" } } });
    expect(add.calls[1]).toMatchObject({ where: { id: "a", workspaceId: "w1" }, data: { tags: ["old", "hot"] } });

    const rm = fakeDb({ a: ["hot", "x"] });
    await editContacts("w1", ["a"], { type: "removeTag", tag: "hot" }, rm.db, rm.fire);
    expect(rm.calls[0].where).toMatchObject({ workspaceId: "w1", tags: { has: "hot" } });
    expect(rm.calls[1].data).toEqual({ tags: ["x"] });
  });

  it("rejects bad input before touching the db", async () => {
    const { db, calls, fire } = fakeDb();
    expect(await editContacts("w1", [], { type: "paused", paused: true }, db, fire)).toEqual({ error: "Pick at least one contact." });
    expect((await editContacts("w1", ["a"], { type: "stage", stage: "NOPE" as never }, db, fire)).error).toBe("Unknown stage.");
    expect((await editContacts("w1", ["a", "b"], { type: "details", notes: "x" }, db, fire)).error).toBe("Edit one contact at a time.");
    expect((await editContacts("w1", ["a"], { type: "details", email: "bad" }, db, fire)).error).toMatch(/email/);
    expect((await editContacts("w1", ["a"], { type: "addTag", tag: "  " }, db, fire)).error).toBe("Write a tag first.");
    expect(calls).toEqual([]);
  });

  it("saves notes and email on one contact", async () => {
    const { db, calls, fire } = fakeDb();
    await editContacts("w1", ["a"], { type: "details", notes: "  call thurs ", email: "" }, db, fire);
    expect(calls.find((c) => c.op === "updateMany")!.data).toEqual({ notes: "call thurs", email: null });
  });
});
