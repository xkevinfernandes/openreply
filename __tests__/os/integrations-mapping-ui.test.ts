// Settings › Integrations › Kit / GoHighLevel: the mapping editor's Custom
// fields section lists every global custom field, and a pick is saved onto
// the field itself (the same value as Settings › Custom fields).
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(os)/os/integrations/actions", () => ({ loadProviderFields: vi.fn(), saveMapping: vi.fn() }));
vi.mock("@/app/(os)/os/settings/actions", () => ({ editField: vi.fn() }));

import MappingEditor, { customFieldRows, FieldSelect, saveFieldTargets } from "@/components/os/integrations/mapping-editor";
import { defaultMapping } from "@/lib/os/integrations/mapping";

const fields = [
  { id: "f1", key: "first_name", label: "First name", ghlField: null, kitField: null, sortOrder: 0 },
  { id: "f2", key: "email", label: "Email", ghlField: null, kitField: null, sortOrder: 1 },
  { id: "f3", key: "their_goal", label: "Their goal", ghlField: null, kitField: "goal", sortOrder: 10 },
  { id: "f4", key: "business", label: "Business", ghlField: "contact.company_name", kitField: null, sortOrder: 20 },
];

const render = (provider: "kit" | "ghl") => renderToStaticMarkup(h(MappingEditor, { provider, initial: defaultMapping(), fields, onSaved: () => {} }));

describe("mapping editor: Custom fields", () => {
  it("is called Custom fields and shows every global field, built-ins included", () => {
    const html = render("kit");
    expect(html).toContain("Custom fields");
    expect(html).not.toMatch(/J(&#x27;|&apos;|')s qualification/);
    for (const f of fields) expect(html).toContain(`>${f.label}`);
    expect(html.indexOf(">First name")).toBeLessThan(html.indexOf(">Business"));
    expect(html.indexOf(">Their goal")).toBeLessThan(html.indexOf(">Business"));
    // First name and Email keep their own slot (a switch, no field picker)
    expect(html).toContain('aria-label="Send first name"');
    expect(html).toContain('aria-label="Send email"');
    expect(html).not.toContain('aria-label="First name: Kit field"');
    expect(html).not.toContain('aria-label="Email: Kit field"');
    expect(html).toContain('aria-label="Business: Kit field"');
  });

  it("shows each field's own target for the provider", () => {
    expect(render("kit")).toMatch(/aria-label="Their goal: Kit field"[^>]*value="goal"/);
    expect(render("ghl")).toMatch(/aria-label="Business: GoHighLevel field"[^>]*value="contact.company_name"/);
  });

  it("keeps the First name / Email switches even without the built-in rows", () => {
    const rows = customFieldRows(fields.slice(2), "kit");
    expect(rows.slice(0, 2).map((r) => [r.key, r.native])).toEqual([
      ["first_name", true],
      ["email", true],
    ]);
  });

  it("lists the provider's real fields when they load", () => {
    const html = renderToStaticMarkup(
      h(FieldSelect, {
        value: "goal",
        onChange: () => {},
        label: "Their goal",
        provider: "kit",
        fieldsError: null,
        fields: { customFields: [{ ref: "goal", label: "Goal" }, { ref: "business", label: "Business" }], pipelines: [] },
      })
    );
    expect(html).toContain("<select");
    expect(html).toContain('<option value="goal" selected="">Goal</option>');
    expect(html).toContain('<option value="business">Business</option>');
  });
});

describe("saving a pick", () => {
  it("writes it onto that field's kitField / ghlField, never on a built-in", async () => {
    const save = vi.fn(async () => ({ field: {} }));
    const kitRows = customFieldRows(fields, "kit");
    expect(await saveFieldTargets(kitRows, { f4: "business", f3: "goal", f1: "first_name_x" }, "kit", save)).toBeNull();
    expect(save.mock.calls).toEqual([["f4", { kitField: "business" }]]);

    save.mockClear();
    await saveFieldTargets(customFieldRows(fields, "ghl"), { f4: null }, "ghl", save);
    expect(save.mock.calls).toEqual([["f4", { ghlField: null }]]);
  });

  it("reports the field that didn't save", async () => {
    const err = await saveFieldTargets(customFieldRows(fields, "kit"), { f4: "x" }, "kit", async () => ({ error: "That field is gone. Refresh." }));
    expect(err).toBe("Business: That field is gone. Refresh.");
  });
});

describe("a hand-typed Kit target", () => {
  it("'business type' matches Kit's business_type instead of showing (not found)", () => {
    const html = renderToStaticMarkup(
      h(FieldSelect, {
        value: "business type",
        onChange: () => {},
        label: "Business",
        provider: "kit",
        fieldsError: null,
        fields: { customFields: [{ ref: "business_type", label: "business_type" }, { ref: "revenue", label: "revenue" }], pipelines: [] },
      })
    );
    expect(html).not.toContain("not found");
    expect(html).toMatch(/<option value="business_type" selected="">/);
  });
});
