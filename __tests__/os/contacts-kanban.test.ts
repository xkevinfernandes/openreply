import { describe, expect, it } from "vitest";
import type { ContactRow } from "../../lib/os/contacts-board";
import { funnelOf, noteFromFields } from "../../lib/os/contacts-board";
import { editContacts, planChange, syncEventFor, type ContactsEditDb } from "../../lib/os/contacts-edit";
import {
  allSources,
  applyChangeLocally,
  boardColumns,
  categoryOf,
  emptyFilters,
  filterContacts,
  groupByColumn,
  onSetter,
  sourceOf,
  withCategory,
} from "../../lib/os/contacts-filter";
import { dropOnColumn, funnelColumns } from "../../lib/os/funnel";

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

describe("contacts kanban (funnel columns)", () => {
  it("merges Showed and No-show into one board column", () => {
    const cols = boardColumns(columns);
    expect(cols.map((c) => c.label)).toEqual(["Open", "Value", "Permission", "Qualify", "Assure", "Book", "Booked", "Showed / No-show", "Won", "Lost"]);
    expect(cols.find((c) => c.key === "showed")?.keys).toEqual(["showed", "no_show"]);
  });

  it("groups cards by J's stage hint, outcomes by stage and attendance", () => {
    const rows = [
      row({ id: "maya", setterStage: "qualify" }),
      row({ id: "jordan", setterStage: "bridge" }),
      row({ id: "priya", stage: "CALL_BOOKED", setterStage: "qualify" }),
      row({ id: "sam", stage: "CALL_BOOKED", attendance: "NO_SHOW" }),
      row({ id: "chris", stage: "WON" }),
      row({ id: "new" }),
    ];
    const g = groupByColumn(rows, columns);
    expect(g.get("qualify")?.map((r) => r.id)).toEqual(["maya"]);
    expect(g.get("assure")?.map((r) => r.id)).toEqual(["jordan"]);
    expect(g.get("booked")?.map((r) => r.id)).toEqual(["priya"]);
    expect(g.get("no_show")?.map((r) => r.id)).toEqual(["sam"]);
    expect(g.get("won")?.map((r) => r.id)).toEqual(["chris"]);
    expect(g.get("open")?.map((r) => r.id)).toEqual(["new"]);
  });

  it("uses a setter's own funnel for its columns", () => {
    const nova = funnelColumns(funnelOf([{ key: "open", label: "Open" }, { key: "qualify", label: "Qualify" }, { key: "booked", label: "Booked" }, 3, null]));
    expect(nova.map((c) => c.key)).toEqual(["open", "qualify", "booked", "showed", "no_show", "won", "lost"]);
  });

  it("dragging into a funnel column is J's hint and frees a card from an outcome", () => {
    const drop = dropOnColumn("qualify", columns);
    expect(drop).toEqual({ setterStage: "qualify" });
    expect(planChange({ type: "setterStage", setterStage: "Qualify!" })).toEqual({ data: { setterStage: "qualify_" } });
    expect(planChange({ type: "setterStage", setterStage: "" })).toEqual({ error: "Unknown column." });
    expect(syncEventFor({ type: "setterStage", setterStage: "qualify" })).toBe("stage_changed");
    const [moved] = applyChangeLocally([row({ id: "a", stage: "CALL_BOOKED", attendance: "NO_SHOW" })], ["a"], { type: "setterStage", setterStage: "qualify" });
    expect(moved).toMatchObject({ setterStage: "qualify", stage: "IN_CONVERSATION", attendance: null });
    expect(groupByColumn([moved], columns).get("qualify")?.length).toBe(1);
  });

  it("a drop into a funnel column goes through the stage writer as Kevin's move, workspace-scoped", async () => {
    const db: ContactsEditDb = {
      contact: {
        updateMany: async () => ({ count: 1 }),
        findMany: async ({ where }) => ((where.workspaceId === "w1" ? [{ id: "a", tags: [] }] : []) as { id: string; tags: string[] }[]),
      },
    };
    const writes: unknown[] = [];
    const fired: string[] = [];
    const write = (async (input: unknown) => {
      writes.push(input);
      return { status: "applied", from: "open", to: "qualify", stage: "IN_CONVERSATION", logged: true };
    }) as unknown as Parameters<typeof editContacts>[6];
    await editContacts("w1", ["a"], { type: "setterStage", setterStage: "qualify" }, db, async (e) => void fired.push(e.event), null, write);
    expect(writes).toEqual([{ workspaceId: "w1", contactId: "a", cause: "user", change: { type: "column", column: "qualify" } }]);
    expect(fired).toEqual(["stage_changed"]);
  });

  it("a refused move is an error and fires nothing", async () => {
    const db: ContactsEditDb = { contact: { updateMany: async () => ({ count: 1 }), findMany: async () => [{ id: "a", tags: [] }] } };
    const fired: string[] = [];
    const write = (async () => ({ status: "refused", from: "booked", to: "qualify", reason: "Change the booking instead." })) as unknown as Parameters<typeof editContacts>[6];
    expect(await editContacts("w1", ["a"], { type: "setterStage", setterStage: "qualify" }, db, async (e) => void fired.push(e.event), null, write)).toEqual({ error: "Change the booking instead." });
    expect(fired).toEqual([]);
  });
});

describe("contacts chips", () => {
  const rows = [
    row({ id: "a", source: "SETTER" }),
    row({ id: "b", entryPath: "story_reply" }),
    row({ id: "c", entryPath: "setter_comment" }),
    row({ id: "d", kind: "PITCHES" }),
    row({ id: "e", source: "SCRIPT", setterId: "nova" }),
  ];

  it("labels the source: keyword, else the way in", () => {
    expect(rows.map(sourceOf)).toEqual(["SETTER", "Story reply", "Reel comment", "Direct", "SCRIPT"]);
    expect(allSources(rows)).toEqual(["SCRIPT", "SETTER", "Direct", "Reel comment", "Story reply"]);
    expect(filterContacts(rows, { ...emptyFilters, source: "SETTER" }).map((r) => r.id)).toEqual(["a"]);
  });

  it("maps the Category chip onto scope and kind", () => {
    expect(categoryOf(emptyFilters)).toBe("SALES");
    const pitches = withCategory(emptyFilters, "PITCHES");
    expect(categoryOf(pitches)).toBe("PITCHES");
    expect(filterContacts(rows, pitches).map((r) => r.id)).toEqual(["d"]);
    expect(filterContacts(rows, withCategory(emptyFilters, "")).length).toBe(5);
    expect(withCategory(pitches, "SALES")).toMatchObject({ scope: "sales", kind: "" });
  });

  it("the Setter chip shows the setter's contacts, defaults included", () => {
    expect(onSetter({ setterId: null }, "j", "j")).toBe(true);
    expect(onSetter({ setterId: "nova" }, "j", "j")).toBe(false);
    expect(onSetter({ setterId: "nova" }, "nova", "j")).toBe(true);
    expect(onSetter({ setterId: "nova" }, "", "j")).toBe(true);
  });

  it("writes J's one-line read for the card", () => {
    expect(noteFromFields([{ key: "their_goal", value: "automate DMs" }, { key: "business", value: "Notion shop" }, { key: "monthly_revenue", value: "~$4k/mo" }])).toBe(
      "Notion shop, ~$4k/mo, automate DMs"
    );
    expect(noteFromFields([])).toBeNull();
  });
});
