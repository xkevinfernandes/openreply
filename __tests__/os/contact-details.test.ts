import { describe, expect, it } from "vitest";
import { detailsFields, mergeLeadMagnets } from "../../lib/os/contact-panel/details";
import { sortActivity, type ActivityItem } from "../../lib/os/contacts-activity";
import type { CustomFieldView } from "../../lib/os/fields/types";

const field = (key: string, label: string, sortOrder: number, usedBy: string[] = ["j"]): CustomFieldView => ({
  id: `f-${key}`,
  key,
  label,
  type: "TEXT",
  builtIn: key === "first_name" || key === "email",
  options: [],
  ghlField: null,
  kitField: null,
  sortOrder,
  usedBy,
});

const FIELDS = [field("email", "Email", 1), field("first_name", "First name", 0), field("business", "Business", 2), field("niche", "Niche", 3, ["nova"])];

describe("Details tab fields", () => {
  it("shows the setter's fields in Settings order, with who filled them", () => {
    const rows = detailsFields(FIELDS, "j", new Map([["business", { value: "Notion shop", source: "j" as const, at: "2026-10-17T10:00:00Z" }]]), { first_name: "Maya", email: null });
    expect(rows.map((r) => r.key)).toEqual(["first_name", "email", "business"]);
    expect(rows[0]).toMatchObject({ value: "Maya", source: "instagram" });
    expect(rows[1]).toMatchObject({ value: null, source: null });
    expect(rows[2]).toMatchObject({ value: "Notion shop", source: "j", bySetter: true });
    expect(rows.filter((r) => r.value).length).toBe(2);
  });

  it("a stored value beats the built-in fallback; no setter list shows every field", () => {
    const rows = detailsFields(FIELDS, null, new Map([["email", { value: "maya@x.co", source: "user" as const, at: null }]]), { email: "old@x.co" });
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.key === "email")).toMatchObject({ value: "maya@x.co", source: "user" });
    expect(detailsFields(FIELDS, "ghost", new Map(), {})).toHaveLength(4);
  });

  it("lists each lead magnet once, oldest first", () => {
    expect(
      mergeLeadMagnets([
        { name: "DM Script Vault", via: "setter", at: "2026-10-18T09:00:00Z" },
        { name: "Setter Starter", via: "setter", at: "2026-10-19T09:00:00Z" },
        { name: "Setter Starter", via: "openreply", at: "2026-10-17T09:00:00Z" },
      ])
    ).toEqual([
      { name: "Setter Starter", via: "openreply", at: "2026-10-17T09:00:00Z" },
      { name: "DM Script Vault", via: "setter", at: "2026-10-18T09:00:00Z" },
    ]);
  });

  it("orders the activity newest first, stable on ties", () => {
    const a = (id: string, at: string): ActivityItem => ({ id, kind: "field", label: id, detail: null, at, by: null });
    expect(sortActivity([a("b", "2026-10-17T00:00:00Z"), a("c", "2026-10-18T00:00:00Z"), a("a", "2026-10-17T00:00:00Z")]).map((x) => x.id)).toEqual(["c", "a", "b"]);
  });
});

import { funnelOf } from "../../lib/os/contact-panel/load";

describe("funnelOf", () => {
  it("skips null and non-object entries", () => {
    expect(funnelOf([null, 3, "x", { key: "open" }, { label: "Qualify" }])).toEqual([
      { key: "open", label: "open" },
      { key: "Qualify", label: "Qualify" },
    ]);
    expect(funnelOf(null)).toEqual([]);
  });
});
