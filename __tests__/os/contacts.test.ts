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
          return Object.entries(tags).map(([id, t]) => ({ id, tags: t }));
        },
      },
    };
    return { db, calls };
  }

  it("scopes every write to the workspace", async () => {
    const { db, calls } = fakeDb();
    expect(await editContacts("w1", ["a", "b", "a"], { type: "stage", stage: "QUALIFIED" }, db)).toEqual({ count: 2 });
    expect(calls[0].where).toEqual({ id: { in: ["a", "b"] }, workspaceId: "w1" });
    expect(calls[0].data).toEqual({ stage: "QUALIFIED" });
  });

  it("a kind change is the user's decision and clears J's suggestion", () => {
    expect(planChange({ type: "kind", kind: "PERSONAL" })).toEqual({
      data: { kind: "PERSONAL", kindSource: "user", suggestedKind: null, suggestedReason: null, suggestedConfidence: null },
    });
  });

  it("adds and removes tags per row, workspace-scoped", async () => {
    const add = fakeDb({ a: ["old"] });
    expect(await editContacts("w1", ["a"], { type: "addTag", tag: "Hot" }, add.db)).toEqual({ count: 1 });
    expect(add.calls[0].where).toMatchObject({ workspaceId: "w1", NOT: { tags: { has: "hot" } } });
    expect(add.calls[1]).toMatchObject({ where: { id: "a", workspaceId: "w1" }, data: { tags: ["old", "hot"] } });

    const rm = fakeDb({ a: ["hot", "x"] });
    await editContacts("w1", ["a"], { type: "removeTag", tag: "hot" }, rm.db);
    expect(rm.calls[0].where).toMatchObject({ workspaceId: "w1", tags: { has: "hot" } });
    expect(rm.calls[1].data).toEqual({ tags: ["x"] });
  });

  it("rejects bad input before touching the db", async () => {
    const { db, calls } = fakeDb();
    expect(await editContacts("w1", [], { type: "paused", paused: true }, db)).toEqual({ error: "Pick at least one contact." });
    expect((await editContacts("w1", ["a"], { type: "stage", stage: "NOPE" as never }, db)).error).toBe("Unknown stage.");
    expect((await editContacts("w1", ["a", "b"], { type: "details", notes: "x" }, db)).error).toBe("Edit one contact at a time.");
    expect((await editContacts("w1", ["a"], { type: "details", email: "bad" }, db)).error).toMatch(/email/);
    expect((await editContacts("w1", ["a"], { type: "addTag", tag: "  " }, db)).error).toBe("Write a tag first.");
    expect(calls).toEqual([]);
  });

  it("saves notes and email on one contact", async () => {
    const { db, calls } = fakeDb();
    await editContacts("w1", ["a"], { type: "details", notes: "  call thurs ", email: "" }, db);
    expect(calls[0].data).toEqual({ notes: "call thurs", email: null });
  });
});
