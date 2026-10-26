// Managed tags (dm-crm issues 005/006): keys, the seed plan (kept in step with
// the SQL seed), resolution through names and aliases, the system tags, and
// Kit names in field sync. No database (the real rename/delete are in
// crm-writers.migrations.test.ts).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { syncContact, type SyncDeps } from "@/lib/os/integrations/engine";
import { defaultMapping } from "@/lib/os/integrations/mapping";
import type { PushedState, SyncProvider } from "@/lib/os/integrations/provider";
import { addTag, type TagDeps } from "@/lib/os/fields/write";
import { planTagSeed, SYSTEM_TAGS, tagKey } from "@/lib/os/tags/key";
import { kitNamesFor, kitTagNames } from "@/lib/os/tags/kit";
import { TAG_COLORS, tagColor } from "@/lib/os/tags/palette";
import { createTag, ensureTag, nameTaken, resolveTag, tagView, type TagStoreDb } from "@/lib/os/tags/store";

describe("tag keys", () => {
  it("variants that differ in case, spaces or separators share a key", () => {
    for (const v of ["Follow-up-friday", "follow up friday", "follow_up_friday", "  FOLLOW--UP  friday ", "follow-up-friday"]) expect(tagKey(v)).toBe("follow-up-friday");
    expect(tagKey("Not-Now")).toBe(tagKey("not_now"));
    expect(tagKey("  ")).toBe("");
  });

  it("the SQL seed uses the same key and system names", () => {
    const sql = readFileSync(path.resolve(__dirname, "../../prisma/migrations/20261027020000_os_crm_tags_seed/migration.sql"), "utf8");
    expect(sql).toContain(`lower(btrim(regexp_replace(btrim(COALESCE(v, '')), '[[:space:]_-]+', '-', 'g'), '-'))`);
    for (const s of SYSTEM_TAGS) expect(sql).toContain(`('${s.name}')`);
  });

  it("every palette colour has a light and a dark value", () => {
    for (const c of TAG_COLORS) for (const v of [c.light.bg, c.light.fg, c.dark.bg, c.dark.fg]) expect(v).toMatch(/^#[0-9A-F]{6}$/i);
    expect(tagColor("nope").key).toBe("gray");
  });
});

describe("the seed plan (dry run)", () => {
  const plan = planTagSeed(
    [
      { name: "Not-Now", count: 3 },
      { name: "hot", count: 2 },
      { name: "Hot", count: 1 },
      { name: "follow up friday", count: 4 },
      { name: "Lead Magnet", count: 1 },
    ],
    [
      { name: "Not-Now", count: 2 },
      { name: "not_now", count: 1 },
    ]
  );
  const by = (k: string) => plan.find((p) => p.key === k)!;

  it("the system name always wins a merge", () => {
    expect(by("not-now")).toMatchObject({ name: "not_now", system: true, merged: ["Not-Now"] });
    expect(by("follow-up-friday")).toMatchObject({ name: "follow-up-friday", system: true, merged: ["follow up friday"] });
  });

  it("otherwise the most used variant; Kit names are what Kit has, most pushed first", () => {
    expect(by("hot")).toMatchObject({ name: "hot", merged: ["Hot"], kitNames: ["hot"] });
    expect(by("not-now").kitNames).toEqual(["Not-Now", "not_now"]);
    expect(by("lead-magnet").kitNames).toEqual(["Lead Magnet"]);
  });

  it("seeds every system tag even when nobody has it", () => {
    for (const s of SYSTEM_TAGS) expect(plan.some((p) => p.name === s.name && p.system)).toBe(true);
  });
});

function memStore(): TagStoreDb & { rows: { id: string; workspaceId: string; name: string; key: string; color: string; kitNames: string[]; system: boolean }[] } {
  const rows = [
    { id: "t1", workspaceId: "w1", name: "not_now", key: "not-now", color: "gray", kitNames: ["Not-Now", "not_now"], system: true },
    { id: "t2", workspaceId: "w1", name: "warm lead", key: "warm-lead", color: "red", kitNames: ["hot"], system: false },
  ];
  const aliases = [{ id: "a1", workspaceId: "w1", tagId: "t2", name: "hot", key: "hot" }];
  return {
    rows,
    list: async (w) => rows.filter((r) => r.workspaceId === w),
    byName: async (w, n) => rows.find((r) => r.workspaceId === w && r.name === n) ?? null,
    byKey: async (w, k) => rows.find((r) => r.workspaceId === w && r.key === k) ?? null,
    aliasByKey: async (w, k) => {
      const a = aliases.find((x) => x.workspaceId === w && x.key === k);
      return a ? { id: a.id, name: a.name, tagId: a.tagId, tag: rows.find((r) => r.id === a.tagId)! } : null;
    },
    aliases: async (w) => aliases.filter((a) => a.workspaceId === w),
    create: async (w, data) => {
      const row = { id: `t${rows.length + 1}`, workspaceId: w, ...data };
      rows.push(row);
      return row;
    },
  };
}

describe("resolving names", () => {
  it("current name, then variant, then an old name; created only when none matches", async () => {
    const s = memStore();
    expect((await resolveTag("w1", "not_now", s))?.id).toBe("t1");
    expect((await resolveTag("w1", "Not-Now", s))?.id).toBe("t1");
    expect((await resolveTag("w1", "HOT", s))?.name).toBe("warm lead");
    expect(await resolveTag("w1", "brand new", s)).toBeNull();
    const before = s.rows.length;
    expect((await ensureTag("w1", "Hot", s))?.name).toBe("warm lead");
    expect(s.rows.length).toBe(before);
    expect((await ensureTag("w1", "brand new", s))?.name).toBe("brand new");
    expect(s.rows.length).toBe(before + 1);
  });

  it("a live alias's name can't become a new tag; nor a taken one", async () => {
    const s = memStore();
    expect(await createTag("w1", { name: "Hot" }, s)).toEqual({ ok: false, error: "This was the old name of warm lead." });
    expect(await createTag("w1", { name: "Not Now" }, s)).toEqual({ ok: false, error: "There's already a tag called not_now." });
    expect(await nameTaken("w1", "hot", s, "t2")).toBeNull(); // its own old name is free for itself
    const made = await createTag("w1", { name: "vip", color: "blue" }, s);
    expect(made).toMatchObject({ ok: true, tag: { name: "vip", color: "blue", kitNames: ["vip"], system: false } });
  });

  it("system tags carry what reads them (the badge's tooltip)", () => {
    expect(tagView({ id: "x", name: "follow-up-friday", key: "follow-up-friday", color: "gray", kitNames: [], system: true })).toMatchObject({ readBy: "Follow-up Friday", kitNames: ["follow-up-friday"] });
  });

  it("the tag writer writes the managed name (J writing an old name)", async () => {
    let tags: string[] = ["x"];
    const s = memStore();
    const deps: TagDeps = {
      tags: async () => tags,
      setTags: async (_w, _c, t) => void (tags = t),
      pendingRemoval: async () => {},
      markDirty: async () => {},
      resolve: async (w, name, create) => (create ? await ensureTag(w, name, s) : await resolveTag(w, name, s))?.name ?? null,
    };
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "HOT", source: "j" }, deps);
    await addTag({ workspaceId: "w1", contactId: "c1", tag: "Not-Now", source: "j" }, deps);
    expect(tags).toEqual(["x", "warm lead", "not_now"]);
  });
});

describe("Kit always sees the same tag name", () => {
  const managed = [
    { name: "not_now", kitNames: ["Not-Now", "not_now"] },
    { name: "warm lead", kitNames: ["hot"] },
  ];

  it("maps contact tags to Kit names; extras only where Kit already has them", () => {
    expect(kitTagNames(["not_now", "warm lead", "other"], managed, [])).toEqual(["Not-Now", "hot", "other"]);
    expect(kitTagNames(["not_now"], managed, ["not_now"])).toEqual(["Not-Now", "not_now"]);
    expect(kitNamesFor("warm lead", managed)).toEqual(["hot"]);
  });

  function harness(contactTags: string[], pushed: string[], removeTags: string[] = []) {
    const pushes: { tags: string[]; removeTags?: string[]; prev: PushedState }[] = [];
    const client: SyncProvider = {
      id: "kit",
      requiresEmail: true,
      verify: async () => {},
      listFields: async () => ({ fields: [] }) as never,
      push: async (p, prev) => {
        pushes.push({ tags: p.tags, removeTags: p.removeTags, prev });
        return { externalId: "sub1", pushedTags: [...new Set([...prev.pushedTags, ...p.tags])].filter((t) => !(p.removeTags ?? []).includes(t)) };
      },
    };
    const deps: SyncDeps = {
      contactSnapshot: async () => ({ id: "c1", kind: "SALES", stage: "IN_CONVERSATION", username: "maya", fullName: "Maya", email: "m@x.co", tags: contactTags, qualification: {} }),
      loadProvider: async () => ({ provider: "kit", client, mapping: { ...defaultMapping(), scope: "all" }, enabled: true }),
      getSyncLog: async () => ({ externalId: "sub1", pushedTags: pushed, lastHash: null, lastError: null }),
      getSyncState: async () => ({ pushedFields: {}, pushedEmail: "m@x.co", removeTags }),
      recordSuccess: async () => {},
      recordFailure: async () => {},
      managedTags: async () => managed,
    };
    return { deps, pushes };
  }

  it("a seed merge (Not-Now → not_now) is never seen as a removal", async () => {
    const h = harness(["not_now"], ["Not-Now"]);
    await syncContact({ workspaceId: "w1", contactId: "c1", provider: "kit", event: "tags_changed" }, h.deps);
    expect(h.pushes[0].tags).toEqual(["Not-Now"]);
    expect(h.pushes[0].removeTags ?? []).toEqual([]);
  });

  it("after a rename, a newly tagged contact gets the original Kit name and nothing is removed", async () => {
    const h = harness(["warm lead"], []);
    await syncContact({ workspaceId: "w1", contactId: "c1", provider: "kit", event: "tags_changed" }, h.deps);
    expect(h.pushes[0].tags).toEqual(["hot"]);
    expect(h.pushes[0].removeTags ?? []).toEqual([]);
  });

  it("an extra Kit name is never pushed for a newly tagged contact; a removal on purpose removes every Kit name", async () => {
    const fresh = harness(["not_now"], []);
    await syncContact({ workspaceId: "w1", contactId: "c1", provider: "kit", event: "tags_changed" }, fresh.deps);
    expect(fresh.pushes[0].tags).toEqual(["Not-Now"]);
    const removed = harness([], ["Not-Now", "not_now"], ["not_now"]);
    await syncContact({ workspaceId: "w1", contactId: "c1", provider: "kit", event: "tags_changed" }, removed.deps);
    expect(removed.pushes[0].removeTags?.sort()).toEqual(["Not-Now", "not_now"]);
  });
});

describe("OS_MOCK tags", () => {
  it("seeds the sample's tags plus the system ones, and renames them on the sample contacts", async () => {
    const { mockTagStore, mockRenameTag, mockTags } = await import("@/lib/os/mock-crm");
    const { mockContactExtras } = await import("@/lib/os/mock");
    const names = mockTags("ws-mock").map((t) => t.name);
    for (const s of SYSTEM_TAGS) expect(names).toContain(s.name);
    expect(names).toContain("hot");
    expect((await resolveTag("ws-mock", "Not-Now", mockTagStore()))?.name).toBe("not_now");
    const hot = mockTags("ws-mock").find((t) => t.name === "hot")!;
    expect(mockRenameTag("ws-mock", hot.id, "warm").ok).toBe(true);
    expect(mockContactExtras("c1").tags).toContain("warm");
    expect(mockRenameTag("ws-mock", mockTags("ws-mock").find((t) => t.name === "client")!.id, "x").ok).toBe(false);
  });
});
