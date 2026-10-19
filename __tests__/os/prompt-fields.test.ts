import { describe, expect, it } from "vitest";
import { profileFromRow, resolvedFromRows, resourceFromCatalog, rowDataFromProfile, type ResourceLike, type SetterRowLike } from "../../lib/os/setter/kb";
import { fileSetter, loadCatalog, loadMethod } from "../../lib/os/setter/knowledge";
import { buildPrompt, systemPrompt } from "../../lib/os/setter/prompt";
import { newRecord } from "../../lib/os/setter/state";

const NOW = new Date("2026-10-19T10:00:00Z");

describe("J's prompt: fields J fills", () => {
  it("the draft JSON has a fields object and says which keys are allowed", () => {
    const rec = newRecord("c1", "maya.builds", "c1");
    const p = buildPrompt(rec, [{ incoming: true, text: "doing about 8k a month", ts: NOW.toISOString() }] as never, { kind: "reply", anchor: "a" } as never, loadCatalog(), NOW);
    expect(p).toContain('"fields": {}');
    expect(p).toContain("only keys from FIELDS TO FILL");
  });

  it("the system prompt lists this setter's fields with their keys", () => {
    const files = fileSetter();
    const setter: SetterRowLike = { id: "s1", autonomy: "APPROVE", ...rowDataFromProfile({ ...files.profile, name: "J" }) };
    const resources: ResourceLike[] = loadCatalog().resources.map((row, i) => ({ id: `r${i}`, ...resourceFromCatalog(row) }));
    const r = resolvedFromRows(setter, resources, [], {
      fields: [
        { key: "first_name", label: "First name", type: "TEXT" },
        { key: "monthly_revenue", label: "Monthly revenue", type: "NUMBER" },
      ],
    });
    const sys = systemPrompt(loadMethod(), r.profile, r.offered, "2026-10-19");
    expect(sys).toContain("### FIELDS TO FILL");
    expect(sys).toContain("- `monthly_revenue`: Monthly revenue (number)");
    // none ticked: no block at all (the golden prompt is unchanged)
    expect(systemPrompt(loadMethod(), profileFromRow(setter), r.offered, "2026-10-19")).not.toContain("FIELDS TO FILL");
  });
});
