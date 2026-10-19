import { describe, expect, it } from "vitest";
import { asFunnel, MAX_VARIATIONS } from "../../lib/os/setter/kb";
import { renderBrandBlock, stageLine, type SetterProfile } from "../../lib/os/setter/profile";
import { fileSetter } from "../../lib/os/setter/knowledge";

const TODAY = "2026-10-19";

describe("funnel variations", () => {
  it("an old stage reads and renders exactly as before", () => {
    const [s] = asFunnel([{ key: "open", label: "Open", guidance: "say hi" }]);
    expect(s).toEqual({ key: "open", label: "Open", guidance: "say hi" });
    expect(stageLine(s)).toBe("**Open** — say hi");
  });

  it("keeps variations, ab and autopilot; drops junk", () => {
    const [s] = asFunnel([
      { label: "Value", guidance: "give one insight", variations: ["  a  ", "", 3, "b"], ab: true, autopilot: "auto" },
    ]);
    expect(s).toEqual({ key: "value", label: "Value", guidance: "give one insight", variations: ["a", "b"], ab: true, autopilot: "auto" });
    const [t] = asFunnel([{ label: "X", guidance: "y", ab: "yes", autopilot: "sometimes", variations: "nope" }]);
    expect(t).toEqual({ key: "x", label: "X", guidance: "y" });
    const [u] = asFunnel([{ label: "X", guidance: "y", variations: Array.from({ length: 20 }, (_, i) => `v${i}`) }]);
    expect(u.variations).toHaveLength(MAX_VARIATIONS);
  });

  it("A/B on: J is told to rotate, never copy", () => {
    const line = stageLine({ key: "open", label: "Open", guidance: "say hi", variations: ["hey!", "yo\nwhat's up"], ab: true });
    expect(line).toContain("**Open** — say hi");
    expect(line).toMatch(/rotate between them, never copy one word for word/);
    expect(line).toContain("  - hey!");
    expect(line).toContain("  - yo what's up");
  });

  it("A/B off: variations stay out of the prompt", () => {
    expect(stageLine({ key: "open", label: "Open", guidance: "say hi", variations: ["hey!"], ab: false })).toBe("**Open** — say hi");
  });

  it("the brand block carries them in the CLIENT JOURNEY", () => {
    const base = fileSetter().profile as SetterProfile;
    const plain = renderBrandBlock(base, [], TODAY);
    const funnel = base.funnel.map((s, i) => (i === 0 ? { ...s, variations: ["first way", "second way"], ab: true } : s));
    const withVars = renderBrandBlock({ ...base, funnel }, [], TODAY);
    expect(withVars).not.toBe(plain);
    expect(withVars).toContain("  - first way");
    expect(renderBrandBlock({ ...base, funnel: base.funnel.map((s) => ({ ...s, autopilot: "auto" as const })) }, [], TODAY)).toBe(plain);
  });
});
