import { describe, expect, it } from "vitest";
import { uniqueKey } from "../../lib/os/fields/store";
import { BUILT_IN_FIELDS, cleanFieldInput, cleanFieldValue, fieldKeyFrom, fieldTypeLabel, isBuiltInKey } from "../../lib/os/fields/types";

describe("custom fields", () => {
  it("derives a stable snake_case key from the name", () => {
    expect(fieldKeyFrom("Monthly revenue")).toBe("monthly_revenue");
    expect(fieldKeyFrom("  What's in the way?  ")).toBe("what_s_in_the_way");
    expect(fieldKeyFrom("Café")).toBe("cafe");
    expect(uniqueKey("business", new Set(["business", "business_2"]))).toBe("business_3");
    expect(uniqueKey("goal", new Set())).toBe("goal");
  });

  it("validates a field from the form", () => {
    expect(cleanFieldInput({ label: "", type: "TEXT" })).toEqual({ error: "Name the field." });
    expect(cleanFieldInput({ label: "Niche", type: "NOPE" as never })).toEqual({ error: "Pick a type." });
    expect(cleanFieldInput({ label: "Niche", type: "SELECT", options: [] })).toEqual({ error: "Add at least one choice." });
    expect(cleanFieldInput({ label: " Niche ", type: "SELECT", options: ["Coach", "Coach", " ", "SaaS"], ghlField: " contact.niche ", kitField: "" })).toEqual({
      label: "Niche",
      type: "SELECT",
      options: ["Coach", "SaaS"],
      ghlField: "contact.niche",
      kitField: null,
    });
    // options only for SELECT
    expect(cleanFieldInput({ label: "Goal", type: "TEXT", options: ["x"] })).toMatchObject({ options: [] });
  });

  it("cleans values by type, blank clears", () => {
    expect(cleanFieldValue("TEXT", "  hi  ")).toEqual({ value: "hi" });
    expect(cleanFieldValue("TEXT", "   ")).toEqual({ value: null });
    expect(cleanFieldValue("EMAIL", "Maya@Builds.co")).toEqual({ value: "maya@builds.co" });
    expect(cleanFieldValue("EMAIL", "nope")).toHaveProperty("error");
    expect(cleanFieldValue("NUMBER", "4,000")).toEqual({ value: "4000" });
    expect(cleanFieldValue("NUMBER", "~4k")).toHaveProperty("error");
    expect(cleanFieldValue("URL", "maya.co")).toEqual({ value: "https://maya.co/" });
    expect(cleanFieldValue("SELECT", "coach", ["Coach", "SaaS"])).toEqual({ value: "Coach" });
    expect(cleanFieldValue("SELECT", "Plumber", ["Coach"])).toHaveProperty("error");
    expect(cleanFieldValue("TEXT", true)).toEqual({ value: "yes" });
  });

  it("knows the built-ins and type labels", () => {
    expect(BUILT_IN_FIELDS.map((f) => f.key)).toEqual(["first_name", "email"]);
    expect(isBuiltInKey("email")).toBe(true);
    expect(isBuiltInKey("business")).toBe(false);
    expect(fieldTypeLabel("LONG_TEXT")).toBe("Long text");
  });
});
