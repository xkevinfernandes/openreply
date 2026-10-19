import { describe, expect, it } from "vitest";
import { buildPayload, defaultMapping, type ContactSnapshot } from "../../lib/os/integrations/mapping";

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
