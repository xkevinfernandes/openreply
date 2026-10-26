import { describe, expect, it } from "vitest";
import { buildTagBoard, usedByWords } from "../../lib/os/tags/board";
import { TAG_COLORS } from "../../lib/os/tags/palette";
import { tagView } from "../../lib/os/tags/store";
import { deleteCheckWords } from "../../lib/os/in-use";

const tag = (id: string, name: string, system = false) => tagView({ id, name, key: name, color: "gray", kitNames: [name], system });

describe("Settings › Tags board", () => {
  it("rows carry contacts, users (by id and by old name) and old names; system first", () => {
    const board = buildTagBoard(
      [tag("t1", "lead-magnet"), tag("t2", "hot"), tag("t3", "follow-up-friday", true)],
      [{ id: "a1", name: "Lead Magnet Old", tagId: "t1" }],
      new Map([
        ["lead-magnet", 4],
        ["follow-up-friday", 37],
      ]),
      [{ id: "b1", name: "Guide drop", audienceTagId: "t1" }],
      [
        { id: "w1", name: "SEND keyword", text: JSON.stringify({ nodes: [{ data: { tag: "Lead Magnet Old" } }] }) },
        { id: "w2", name: "Other", text: JSON.stringify({ nodes: [{ data: { tag: "cold" } }] }) },
      ],
      new Set(["hot"])
    );
    expect(board.rows.map((r) => r.name)).toEqual(["follow-up-friday", "hot", "lead-magnet"]);
    expect(board.total).toBe(3);
    expect(board.system).toBe(1);
    const lm = board.rows.find((r) => r.id === "t1")!;
    expect(lm.contacts).toBe(4);
    expect(lm.usedBy.map((u) => `${u.kind}:${u.name}`)).toEqual(["broadcast:Guide drop", "workflow:SEND keyword"]);
    expect(lm.aliases).toEqual([{ id: "a1", name: "Lead Magnet Old" }]);
    expect(board.rows.find((r) => r.id === "t2")!.usedBy).toEqual([]);
    // The tooltip says why it's pinned.
    expect(board.rows.find((r) => r.id === "t3")!.readBy).toMatch(/^Follow-up Friday \(.*Friday switch.*Friday broadcast/);
    // Only a tag Kit has received has a Kit name to keep.
    expect(board.rows.find((r) => r.id === "t2")!.kitSynced).toBe(true);
    expect(lm.kitSynced).toBe(false);
  });

  it("names users in plain words for the refusal", () => {
    expect(usedByWords([{ kind: "broadcast", name: "Guide drop" }, { kind: "workflow", name: "SEND keyword" }])).toBe('the broadcast "Guide drop" and the workflow "SEND keyword"');
    expect(usedByWords([{ kind: "workflow", name: "A" }])).toBe('the workflow "A"');
    // A name that starts with its kind isn't doubled ("Campaign Campaign SETTER"), and repeats show once.
    expect(usedByWords([{ kind: "Campaign", name: "Campaign SETTER" }])).toBe('the campaign "SETTER"');
    expect(usedByWords([{ kind: "broadcast", name: "FF" }, { kind: "broadcast", name: "FF" }])).toBe('the broadcast "FF"');
  });

  it("tags and resources share the delete dialog's words", () => {
    expect(deleteCheckWords({ name: "hot", used: [] })).toEqual({ title: 'Delete "hot"?', hint: null, confirm: "Delete" });
    const tagInUse = deleteCheckWords({ name: "hot", used: [{ kind: "broadcast", name: "Guide drop" }] });
    expect(tagInUse).toEqual({ title: '"hot" is in use', hint: 'It\'s used by the broadcast "Guide drop". Delete anyway and they stop matching.', confirm: "Delete anyway" });
    const resInUse = deleteCheckWords({ name: "Vault", used: [{ kind: "Campaign", name: "Campaign SETTER" }], refuse: true });
    expect(resInUse).toEqual({ title: '"Vault" is in use', hint: 'It\'s used by the campaign "SETTER". Remove it there first.', confirm: null });
  });

  it("the colour dropdown offers every palette colour with a light and dark shade", () => {
    expect(TAG_COLORS.length).toBeGreaterThan(5);
    for (const c of TAG_COLORS) {
      expect(c.label).toBeTruthy();
      expect(c.light.bg).toMatch(/^#/);
      expect(c.dark.fg).toMatch(/^#/);
    }
  });
});

describe("Settings › Tags rules in mock mode (store)", () => {
  it("rename, refuse a taken old name, free it, refuse system, delete with force", async () => {
    process.env.OS_MOCK = "1";
    try {
      const { createTag, deleteTag, freeAlias, listTagAliases, listTags, renameTag } = await import("../../lib/os/tags/store");
      const ws = "ws-tags-test";
      const made = await createTag(ws, { name: "warm-lead", color: "orange" });
      expect(made.ok).toBe(true);
      const id = made.ok ? made.tag.id : "";
      const renamed = await renameTag(ws, id, "hot-lead");
      expect(renamed.ok && renamed.tag.name).toBe("hot-lead");
      // Nothing used it and Kit never saw it: no old name kept, Kit takes the new name.
      expect(renamed.ok && renamed.tag.kitNames).toEqual(["hot-lead"]);
      expect((await listTagAliases(ws)).some((a) => a.name === "warm-lead")).toBe(false);
      // A tag on sample contacts keeps its old name as an alias.
      const hot = (await listTags(ws)).find((t) => t.name === "hot")!;
      expect((await renameTag(ws, hot.id, "warm")).ok).toBe(true);
      expect((await createTag(ws, { name: "hot" })).ok).toBe(false);
      const alias = (await listTagAliases(ws)).find((a) => a.name === "hot")!;
      expect((await freeAlias(ws, alias.id)).ok).toBe(true);
      expect((await createTag(ws, { name: "hot" })).ok).toBe(true);
      const sys = (await listTags(ws)).find((t) => t.system)!;
      expect((await renameTag(ws, sys.id, "x")).ok).toBe(false);
      expect((await deleteTag(ws, sys.id)).ok).toBe(false);
      expect((await deleteTag(ws, id, { force: true })).ok).toBe(true);
    } finally {
      delete process.env.OS_MOCK;
    }
  });
});
