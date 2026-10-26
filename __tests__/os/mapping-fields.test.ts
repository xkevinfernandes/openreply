import { describe, expect, it } from "vitest";
import { buildPayload, defaultMapping, mappingFieldRows, withStoredQualification, type ContactSnapshot } from "../../lib/os/integrations/mapping";

const contact = (over: Partial<ContactSnapshot> = {}): ContactSnapshot => ({
  id: "c1",
  kind: "SALES",
  stage: "QUALIFIED",
  username: "maya.builds",
  fullName: "Maya Lee",
  email: null,
  tags: [],
  qualification: { their_goal: "old goal from drafts", niche: "Creator" },
  ...over,
});

describe("CRM payload from global custom fields", () => {
  it("puts each field on its own provider target", () => {
    const c = contact({
      fields: [
        { key: "business", value: "Notion shop", ghlField: "contact.company_name", kitField: "business" },
        { key: "monthly_revenue", value: "~$4k/mo", ghlField: "Monthly revenue", kitField: null },
      ],
    });
    expect(buildPayload(c, defaultMapping(), "ghl").custom).toEqual({ "contact.company_name": "Notion shop", "Monthly revenue": "~$4k/mo" });
    expect(buildPayload(c, defaultMapping(), "kit").custom).toEqual({ business: "Notion shop" });
  });

  it("falls back to the legacy qualification mapping for keys no field covers", () => {
    const m = { ...defaultMapping(), qualification: { their_goal: "goal_field", niche: "niche_field" } };
    const c = contact({ fields: [{ key: "their_goal", value: "Automate DMs", ghlField: "Goal", kitField: null }] });
    // GHL: the custom field wins, niche still comes from the old mapping
    expect(buildPayload(c, m, "ghl").custom).toEqual({ Goal: "Automate DMs", niche_field: "Creator" });
    // Kit: no field target, so the legacy mapping sends the field's value (not the draft's)
    expect(buildPayload(c, m, "kit").custom).toEqual({ goal_field: "Automate DMs", niche_field: "Creator" });
    // no provider: legacy behaviour
    expect(buildPayload(contact(), m).custom).toEqual({ goal_field: "old goal from drafts", niche_field: "Creator" });
  });

  it("uses the first_name / email field values when the contact row has none", () => {
    const c = contact({ fullName: null, fields: [{ key: "first_name", value: "Maya", ghlField: "x", kitField: "y" }, { key: "email", value: "Maya@B.co", ghlField: null, kitField: null }] });
    const p = buildPayload(c, defaultMapping(), "kit");
    expect(p.firstName).toBe("Maya");
    expect(p.email).toBe("maya@b.co");
    expect(p.custom).toEqual({});
    expect(buildPayload(contact({ email: "row@b.co", fields: [{ key: "email", value: "f@b.co", ghlField: null, kitField: null }] }), defaultMapping(), "kit").email).toBe("row@b.co");
  });
});

describe("one source of truth: the field's own target", () => {
  const targets = [
    { key: "first_name", ghlField: null, kitField: "first_name_custom" },
    { key: "their_goal", ghlField: "Goal", kitField: "goal" },
    { key: "niche", ghlField: null, kitField: null },
  ];

  it("sends a draft answer to its field's target when the contact has no stored value", () => {
    const c = contact({ fields: [], targets });
    expect(buildPayload(c, defaultMapping(), "kit").custom).toEqual({ goal: "old goal from drafts" });
    expect(buildPayload(c, defaultMapping(), "ghl").custom).toEqual({ Goal: "old goal from drafts" });
  });

  it("still pushes through the legacy mapping when the field has no target", () => {
    const m = { ...defaultMapping(), qualification: { niche: "niche_field", fit_score: "fit" } };
    const c = contact({ qualification: { niche: "Creator", fit_score: "4" }, targets });
    // niche has a field without a Kit target, fit_score has no field at all: both keep syncing
    expect(buildPayload(c, m, "kit").custom).toEqual({ niche_field: "Creator", fit: "4" });
  });

  it("a mapping saved onto the field wins over the legacy one", () => {
    const m = { ...defaultMapping(), qualification: { their_goal: "old_goal_field" } };
    expect(buildPayload(contact({ targets }), m, "kit").custom).toEqual({ goal: "old goal from drafts" });
  });

  it("never sends first name or email into a custom slot", () => {
    const c = contact({ fields: [{ key: "first_name", value: "Maya", ghlField: null, kitField: "first_name_custom" }], targets });
    const p = buildPayload(c, defaultMapping(), "kit");
    expect(p.firstName).toBe("Maya");
    expect(p.custom.first_name_custom).toBeUndefined();
  });
});

describe("mapping screen rows", () => {
  const fields = [
    { id: "f3", key: "business", label: "Business", ghlField: "contact.company_name", kitField: "business", sortOrder: 20 },
    { id: "f1", key: "first_name", label: "First name", ghlField: null, kitField: "x", sortOrder: 0 },
    { id: "f2", key: "email", label: "Email", ghlField: null, kitField: null, sortOrder: 1 },
    { id: "f4", key: "niche", label: "Niche", ghlField: null, kitField: "niche", sortOrder: 14 },
  ];

  it("lists every global field in sort order with the provider's target", () => {
    const rows = mappingFieldRows(fields, "kit");
    expect(rows.map((r) => r.key)).toEqual(["first_name", "email", "niche", "business"]);
    expect(rows.find((r) => r.key === "business")?.target).toBe("business");
    expect(mappingFieldRows(fields, "ghl").find((r) => r.key === "business")?.target).toBe("contact.company_name");
    // the built-ins keep their own slot: shown, never remappable
    expect(rows.filter((r) => r.native).map((r) => r.key)).toEqual(["first_name", "email"]);
    expect(rows.find((r) => r.key === "first_name")?.target).toBeNull();
  });

  it("keeps the stored legacy targets when the form saves (never written from the form)", () => {
    const saved = withStoredQualification({ scope: "all", qualification: { niche: "from_form" } }, { qualification: { pain: "kept" } });
    expect(saved.scope).toBe("all");
    expect(saved.qualification).toEqual({ pain: "kept" });
    expect(withStoredQualification({ qualification: { niche: "x" } }, null).qualification).toEqual({});
  });
});
