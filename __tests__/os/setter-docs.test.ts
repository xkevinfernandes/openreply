import { describe, expect, it } from "vitest";
import { profileFromRow, resolvedFromRows, resourceFromCatalog, rowDataFromProfile, type ResourceLike, type SetterRowLike } from "../../lib/os/setter/kb";
import {
  businessKey,
  docCount,
  docsFromProfile,
  parseBusinessDoc,
  parseOffersDoc,
  parseSystemPrompt,
  stripTitle,
} from "../../lib/os/setter/knowledge/docs";
import { fileSetter, loadCatalog, loadMethod } from "../../lib/os/setter/knowledge";
import { renderBrandBlock } from "../../lib/os/setter/profile";
import { systemPrompt } from "../../lib/os/setter/prompt";

const TODAY = "2026-10-18";

/** The claudepreneur profile as the JSON columns hold it. */
function claudepreneur() {
  const files = fileSetter();
  const setter: SetterRowLike = { id: "s1", autonomy: "APPROVE", ...rowDataFromProfile({ ...files.profile, name: "J" }) };
  const resources: ResourceLike[] = loadCatalog().resources.map((row, i) => ({ id: `r${i}`, ...resourceFromCatalog(row) }));
  return { files, setter, resources };
}

describe("setter docs: the golden test", () => {
  it("claudepreneur renders the same brand block before and after the JSON → Markdown move", () => {
    const { setter, resources } = claudepreneur();
    const enabled = resources.filter((r) => r.kind === "resource").map((r) => r.id);
    const before = resolvedFromRows(setter, resources, enabled);
    const docs = docsFromProfile(profileFromRow(setter));
    const after = resolvedFromRows(setter, resources, enabled, { docs });
    const a = renderBrandBlock(before.profile, before.offered.resources, TODAY);
    const b = renderBrandBlock(after.profile, after.offered.resources, TODAY);
    expect(b).toBe(a);
    expect(systemPrompt(loadMethod(), after.profile, after.offered, TODAY)).toBe(systemPrompt(loadMethod(), before.profile, before.offered, TODAY));
    // and it is the real thing, not two empty blocks
    expect(a).toContain("### OFFERS");
    expect(a).toContain("### Objection playbook");
    expect(a).toContain("### VOICE (overrides");
  });

  it("is stable: docs → profile → docs gives the same docs", () => {
    const { setter } = claudepreneur();
    const docs = docsFromProfile(profileFromRow(setter));
    expect(docsFromProfile(profileFromRow(setter, docs))).toEqual(docs);
  });

  it("System prompt.md holds only persona and voice: the method is never in a doc", () => {
    const { setter } = claudepreneur();
    const docs = docsFromProfile(profileFromRow(setter));
    expect(docs.system_prompt).toMatch(/^# System prompt\n\n## Voice\n/);
    expect(docs.system_prompt).not.toContain(loadMethod().slice(0, 200));
  });

  it("keeps the JSON columns as the fallback for a doc that doesn't exist", () => {
    const { setter } = claudepreneur();
    const json = profileFromRow(setter);
    const p = profileFromRow(setter, { offers: "# Offers\n\n## Only one\nStatus: open\n" });
    expect(p.offers.map((o) => o.name)).toEqual(["Only one"]);
    expect(p.voice).toBe(json.voice);
    expect(p.business).toEqual(json.business);
    expect(p.examples).toBe(json.examples);
  });
});

describe("setter docs: parsing", () => {
  it("System prompt.md: persona above ## Voice, examples below ## Examples", () => {
    const md = "# J\n\nYou are J. Peer to peer.\n\n## Voice\n\nlowercase.\n### Words\nhbu\n\n## Examples\n\n- yo";
    expect(parseSystemPrompt(md)).toEqual({ persona: "You are J. Peer to peer.", voice: "lowercase.\n### Words\nhbu", voiceExamples: "- yo" });
    expect(parseSystemPrompt("just a voice")).toEqual({ persona: "", voice: "just a voice", voiceExamples: "" });
  });

  it("a persona reaches the brand block; none adds nothing", () => {
    const { setter } = claudepreneur();
    const docs = docsFromProfile(profileFromRow(setter));
    const withPersona = profileFromRow(setter, { system_prompt: docs.system_prompt.replace("# System prompt\n\n", "# System prompt\n\nYou are J, Kevin's setter.\n\n") });
    expect(withPersona.persona).toBe("You are J, Kevin's setter.");
    expect(renderBrandBlock(withPersona, [], TODAY)).toContain("### WHO YOU ARE\nYou are J, Kevin's setter.");
  });

  it("Business.md: friendly headings map to the keys J reads; tbd means unknown", () => {
    expect(businessKey("Outcome they buy")).toBe("outcome");
    expect(businessKey("Who I don't serve")).toBe("who_i_dont_serve");
    expect(businessKey("Never do")).toBe("voice_never_do");
    expect(parseBusinessDoc("# Business\n\n## Offer\n\nA build.\n\n## Proof\n\ntbd\n\n## ICP\n")).toEqual({ offer: "A build.", proof: "", icp: "" });
  });

  it("Offers.md: one canonical format, read leniently", () => {
    const md = [
      "# Offers",
      "What J can point people toward.",
      "## Setter Build (1:1)",
      "- **Price:** 3.5k — say it only on the call",
      "Fit: Owners doing $3k+/mo",
      "Status: Open",
      "When to offer: After Assure",
      "## Case study build",
      "Status: open. Sold by: call. We build the first agents together.",
      "## Closed one",
      "status: closed",
      "price_in_dms: never",
    ].join("\n");
    const [a, b, c] = parseOffersDoc(md);
    expect(a).toMatchObject({ name: "Setter Build (1:1)", status: "open", sold_by: "call", price: "3.5k — say it only on the call", fit_criteria: "Owners doing $3k+/mo", notes: "When to offer: After Assure" });
    expect(b).toMatchObject({ name: "Case study build", status: "open", sold_by: "call", notes: "We build the first agents together." });
    expect(c).toMatchObject({ status: "closed", price_in_dms: "no" });
  });

  it("strips the title and counts sections for the tree", () => {
    expect(stripTitle("---\na: 1\n---\n# Offers\n\n## X")).toBe("## X");
    expect(docCount("objections", "# Objections\n\n## A\nx\n\n## B\ny")).toBe(2);
    expect(docCount("system_prompt", "x")).toBeNull();
  });
});

describe("best episodes and fields J fills", () => {
  it("episodes leave the catalog and become their own block, in order", () => {
    const { setter, resources } = claudepreneur();
    const ep = (id: string, name: string, sortOrder: number): ResourceLike => ({
      id,
      slug: id,
      kind: "episode",
      name,
      link: `https://youtu.be/${id}`,
      keyword: null,
      status: "ACTIVE",
      description: "",
      data: { when: `when ${name}` },
      ...{ sortOrder },
    });
    const r = resolvedFromRows(setter, [...resources, ep("e1", "First", 0), ep("e2", "Second", 1)], []);
    expect(r.catalog.resources.some((x) => x.slug === "e1")).toBe(false);
    const block = renderBrandBlock(r.profile, r.offered.resources, TODAY);
    expect(block).toContain("### BEST EPISODES");
    expect(block.indexOf("**First**")).toBeLessThan(block.indexOf("**Second**"));
    expect(block).toContain("when: when First");
  });

  it("fields J fills are listed with their keys", () => {
    const { setter, resources } = claudepreneur();
    const r = resolvedFromRows(setter, resources, [], { fields: [{ key: "monthly_revenue", label: "Monthly revenue", type: "NUMBER" }] });
    const block = renderBrandBlock(r.profile, r.offered.resources, TODAY);
    expect(block).toContain("`monthly_revenue`: Monthly revenue (number)");
    expect(block).toContain('"fields"');
  });
});
