import { describe, expect, it } from "vitest";
import { setterMarkdown } from "../../lib/os/setter/export";
import {
  asFunnel,
  asOffers,
  catalogRowFromResource,
  profileFromRow,
  resolvedFromRows,
  resourceFromCatalog,
  rowDataFromProfile,
  type ResourceLike,
  type SetterRowLike,
} from "../../lib/os/setter/kb";
import { fileSetter, loadCatalog, loadMethod } from "../../lib/os/setter/knowledge";
import { correctionsBlock, parseCorrections, renderBrandBlock } from "../../lib/os/setter/profile";
import { systemPrompt } from "../../lib/os/setter/prompt";
import { entryOpener, sandboxReply, sandboxThread } from "../../lib/os/setter/sandbox";
import { draftForContact } from "../../lib/os/setter/service";
import type { DraftView, NewDraft, SetterStore } from "../../lib/os/setter/store";
import type { KnowledgeSource } from "../../lib/os/setter/kb";

const TODAY = "2026-10-18";

/** The bundled files, imported the way scripts/os-import-knowledge.ts does, as in-memory rows. */
function importedRows() {
  const files = fileSetter();
  const setter: SetterRowLike = { id: "s1", autonomy: "APPROVE", ...rowDataFromProfile({ ...files.profile, name: "Default" }) };
  const resources: ResourceLike[] = loadCatalog().resources.map((row, i) => ({ id: `r${i}`, ...resourceFromCatalog(row) }));
  return { files, setter, resources };
}

describe("import: files → rows → what J reads", () => {
  it("renders the same brand block from the DB rows as from the files", () => {
    const { files, setter, resources } = importedRows();
    const enabled = resources.filter((r) => r.kind === "resource").map((r) => r.id);
    const db = resolvedFromRows(setter, resources, enabled);
    const fromFiles = renderBrandBlock({ ...files.profile, name: "Default" }, files.offered.resources, TODAY);
    expect(renderBrandBlock(db.profile, db.offered.resources, TODAY)).toBe(fromFiles);
    expect(db.source).toBe("db");
    expect(db.catalog.tag_options).toEqual(loadCatalog().tag_options);
  });

  it("round-trips catalog rows through the Resource columns", () => {
    for (const row of loadCatalog().resources) {
      const back = catalogRowFromResource({ id: "x", ...resourceFromCatalog(row) });
      expect(back.slug).toBe(row.slug);
      expect(back.type ?? "resource").toBe(row.type ?? "resource");
      expect(back.resource_url ?? null).toBe(row.resource_url || null);
      expect(back.for_setter ?? null).toBe(row.for_setter || null);
      expect(back.triggers ?? []).toEqual(row.triggers ?? []);
      expect(back.zernio).toEqual(row.zernio);
      expect(back.opener).toEqual(row.opener);
    }
  });

  it("only lead magnets switched on reach the brand block; entry paths always stay in the catalog", () => {
    const { setter, resources } = importedRows();
    const yt = resources.find((r) => r.slug === "yt02")!;
    const db = resolvedFromRows(setter, resources, [yt.id]);
    const brand = systemPrompt(loadMethod(), db.profile, db.offered, TODAY);
    expect(brand).toContain("youtu.be/shZi3aes5Rg");
    expect(brand).not.toContain("ai.claudepreneur.com");
    expect(db.offered.resources.map((r) => r.slug)).toContain("lm-workshop-setter");
    expect(db.catalog.resources.map((r) => r.slug)).toContain("dm-setter-workshop");
  });

  it("a new keyword on a resource becomes a trigger J recognises", () => {
    const row = catalogRowFromResource({
      id: "x",
      slug: "guide",
      kind: "resource",
      name: "Guide",
      link: "https://x.io/g",
      keyword: "GUIDE",
      status: "ACTIVE",
      description: "a guide",
      data: {},
    });
    expect(row.triggers).toEqual([{ surface: "comment", post_id: null, keyword: "GUIDE", automation_id: null }]);
    expect(row.status).toBe("active");
  });
});

describe("profile shapes", () => {
  it("coerces offers and funnel from untrusted JSON", () => {
    const offers = asOffers([{ name: " Call ", status: "open", price: "", sold_by: "nope" }, { name: "" }, "junk"]);
    expect(offers).toEqual([{ name: "Call", status: "open", sold_by: "call", price_in_dms: "no", notes: "" }]);
    expect(asFunnel([{ label: "Open", guidance: "say hi" }, { label: "", guidance: "x" }])).toEqual([{ key: "open", label: "Open", guidance: "say hi" }]);
    expect(profileFromRow({ id: "s", name: "N", autonomy: "AUTO", settings: null, business: 3, offers: {}, funnel: null, voice: "", voiceExamples: "", examples: "", voiceCorrections: "x" }).offers).toEqual([]);
  });

  it("splits voice corrections into entries and folds the latest into the prompt", () => {
    const entries = parseCorrections(
      "---\n# header\n---\n\n- you wrote: 'a'\n  my version: 'b'\n\n<!-- c -->\n\n> blurb\n\n## Correction 1 — @x\n\n**J drafted:**\n\n> hi\n\n---\n\n## Correction 2 — @y\n\nbody 2\n"
    );
    expect(entries.map((e) => e.title)).toEqual(["Pinned correction", "Correction 1 — @x", "Correction 2 — @y"]);
    expect(entries[1].body).toBe("**J drafted:**\n\n> hi");
    const block = correctionsBlock(entries, 2);
    expect(block).toContain("Correction 2");
    expect(block).not.toContain("you wrote");
    expect(correctionsBlock([])).toBe("");
  });

  it("exports a knowledge base as one markdown file", () => {
    const { files } = importedRows();
    const md = setterMarkdown(
      { ...files.profile, name: "Default" },
      files.catalog.resources.map((row) => ({ row, enabled: row.slug === "yt02" })),
      new Date("2026-10-18T12:00:00Z")
    );
    expect(md).toMatch(/^# Default — knowledge base/);
    expect(md).toContain("## Offers");
    expect(md).toContain("### Case study offer");
    expect(md).toContain("- [x] **Sold-Out Coaches");
    expect(md).toContain("## Voice corrections");
    expect(md).not.toContain("Setting Script.md");
  });
});

describe("sandbox", () => {
  it("starts with the campaign opener and answers with the fake backend", async () => {
    const setter = fileSetter();
    expect(entryOpener(setter, "lm-workshop-setter")).toBe("hey! are you here for the AI DM setter workshop?");
    const now = new Date("2026-10-18T10:00:00Z");
    const thread = sandboxThread([{ from: "lead", text: "yes" }], "opener", now);
    expect(thread.map((m) => m.incoming)).toEqual([false, true]);
    expect(thread[1].at).toBe("2026-10-18T10:00:00Z");

    const reply = await sandboxReply(setter, [{ from: "lead", text: "hey how do you build these agents?" }], { now });
    expect(reply.usage.backend).toBe("fake");
    expect(reply.bubbles.length).toBeGreaterThan(0);
    expect(reply.flags).toContain("sample");

    const held = await sandboxReply(setter, [{ from: "lead", text: "[fake:hold] ok" }], { now });
    expect(held.hold).toBe(true);
    expect(held.bubbles).toEqual([]);
    await expect(sandboxReply(setter, [], { now })).rejects.toThrow(/lead first/);
  });
});

describe("draftForContact picks the contact's setter", () => {
  it("asks the knowledge source for this contact and records the setter on the draft", async () => {
    const { setter, resources } = importedRows();
    const db = resolvedFromRows(setter, resources, []);
    const seen: string[] = [];
    const knowledge: KnowledgeSource = {
      forContact: async (c) => {
        seen.push(c.id);
        return db;
      },
      forSetter: async () => db,
    };
    let created: (DraftView & { setterId?: string | null }) | null = null;
    const store = {
      getContact: async () => ({ id: "c1", workspaceId: "w1", igUserId: "1", username: "sam", conversationId: "x", kind: "SALES", paused: false, tags: [] }),
      readThread: async () => [{ id: "m1", text: "hey what do you do?", incoming: true, at: "2026-10-18T10:00:00Z" }],
      loadState: async () => null,
      saveState: async () => {},
      pendingDraft: async () => null,
      createDraft: async (input: NewDraft) => (created = { ...input, id: "d1", status: "PENDING", createdAt: "" }),
    } as unknown as SetterStore;
    const r = await draftForContact("c1", { store, knowledge, now: new Date("2026-10-18T10:05:00Z") });
    expect(r.status).toBe("drafted");
    expect(seen).toEqual(["c1"]);
    expect(created!.setterId).toBe("s1");
  });
});
