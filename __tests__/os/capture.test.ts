import { describe, expect, it } from "vitest";
import { answersFromRaw, captureFields, planCapture, type CaptureDeps, type CaptureField } from "../../lib/os/fields/capture";

const FIELDS: CaptureField[] = [
  { id: "f-biz", key: "business", type: "TEXT", options: [] },
  { id: "f-goal", key: "their_goal", type: "TEXT", options: [] },
  { id: "f-rev", key: "monthly_revenue", type: "TEXT", options: [] },
  { id: "f-niche", key: "niche", type: "SELECT", options: ["Coach", "Creator"] },
  { id: "f-email", key: "email", type: "EMAIL", options: [] },
];

describe("J's field capture", () => {
  it("reads fields (object or list) first, then qualification and invite", () => {
    const a = answersFromRaw({
      fields: { business: "Notion shop", their_goal: null },
      qualification: { business: "ignored", niche: "creator", fit_score: 0, is_owner: true },
      invite: { their_goal: "Automate DMs" },
    });
    expect(Object.fromEntries(a)).toEqual({ business: "Notion shop", niche: "creator", is_owner: "yes", their_goal: "Automate DMs" });
    expect(Object.fromEntries(answersFromRaw({ fields: [{ key: "business", value: "Shop" }, { key: "x" }] }))).toEqual({ business: "Shop" });
    expect(answersFromRaw(null).size).toBe(0);
    expect(answersFromRaw({ qualification: { niche: "unknown", pain: "null" } }).size).toBe(0);
  });

  it("never overwrites Kevin's value, skips unchanged and invalid, honours the setter's list", () => {
    const answers = new Map([
      ["business", "Notion shop"],
      ["their_goal", "Automate DMs"],
      ["monthly_revenue", "~$4k"],
      ["niche", "plumber"],
      ["email", "maya@x.co"],
    ]);
    const existing = [
      { fieldId: "f-biz", value: "Kevin wrote this", source: "user" },
      { fieldId: "f-goal", value: "Automate DMs", source: "j" },
    ];
    expect(planCapture(answers, FIELDS, [], existing)).toEqual([
      { fieldId: "f-rev", value: "~$4k" },
      { fieldId: "f-email", value: "maya@x.co" },
    ]);
    expect(planCapture(answers, FIELDS, ["f-rev"], existing)).toEqual([{ fieldId: "f-rev", value: "~$4k" }]);
  });

  it("loads Draft.raw by draftId when the hook passes none, writes, then syncs once", async () => {
    const writes: unknown[] = [];
    const fired: unknown[] = [];
    const asked: string[] = [];
    const deps: CaptureDeps = {
      draftRaw: async (id) => {
        asked.push(id);
        return { qualification: { niche: "Coach", monthly_revenue: "$10k" } };
      },
      fields: async () => FIELDS,
      setterFieldIds: async () => [],
      existing: async () => [],
      write: async (row) => void writes.push(row),
      fire: async (e) => void fired.push(e),
    };
    const n = await captureFields({ workspaceId: "w", contactId: "c", setterId: "s", draftId: "d1", raw: undefined }, deps);
    expect(n).toBe(2);
    expect(asked).toEqual(["d1"]);
    expect(writes).toEqual([
      { contactId: "c", fieldId: "f-rev", value: "$10k", draftId: "d1" },
      { contactId: "c", fieldId: "f-niche", value: "Coach", draftId: "d1" },
    ]);
    expect(fired).toEqual([{ workspaceId: "w", contactId: "c", event: "manual" }]);
  });

  it("does nothing (and no sync) when there's nothing new", async () => {
    const fired: unknown[] = [];
    const deps: CaptureDeps = {
      draftRaw: async () => ({}),
      fields: async () => FIELDS,
      setterFieldIds: async () => [],
      existing: async () => [],
      write: async () => {},
      fire: async (e) => void fired.push(e),
    };
    expect(await captureFields({ workspaceId: "w", contactId: "c", setterId: null, draftId: "d" }, deps)).toBe(0);
    expect(fired).toEqual([]);
  });
});
