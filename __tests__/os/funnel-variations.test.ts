import { describe, expect, it } from "vitest";
import { asFunnel, MAX_VARIATIONS } from "../../lib/os/setter/kb";
import { renderBrandBlock, stageLine, type SetterProfile } from "../../lib/os/setter/profile";
import { fileSetter } from "../../lib/os/setter/knowledge";

const TODAY = "2026-10-19";

// The untracked Funnel "Variations" are gone: line tests replace them. Old
// variation text is kept (untouched) until scripts/os-migrate-variations.ts
// turns it into a draft test, but never reaches J's prompt.
describe("funnel variations (legacy)", () => {
  it("an old stage reads and renders exactly as before", () => {
    const [s] = asFunnel([{ key: "open", label: "Open", guidance: "say hi" }]);
    expect(s).toEqual({ key: "open", label: "Open", guidance: "say hi" });
    expect(stageLine(s)).toBe("**Open** — say hi");
  });

  it("keeps variation text for the migration, drops the ab switch and junk", () => {
    const [s] = asFunnel([{ label: "Value", guidance: "give one insight", variations: ["  a  ", "", 3, "b"], ab: true, autopilot: "auto" }]);
    expect(s).toEqual({ key: "value", label: "Value", guidance: "give one insight", variations: ["a", "b"], autopilot: "auto" });
    const [u] = asFunnel([{ label: "X", guidance: "y", variations: Array.from({ length: 20 }, (_, i) => `v${i}`) }]);
    expect(u.variations).toHaveLength(MAX_VARIATIONS);
  });

  it("variations never reach the prompt", () => {
    expect(stageLine({ key: "open", label: "Open", guidance: "say hi", variations: ["hey!", "yo"] })).toBe("**Open** — say hi");
    const base = fileSetter().profile as SetterProfile;
    const plain = renderBrandBlock(base, [], TODAY);
    const funnel = base.funnel.map((s, i) => (i === 0 ? { ...s, variations: ["first way", "second way"] } : s));
    expect(renderBrandBlock({ ...base, funnel }, [], TODAY)).toBe(plain);
  });
});
