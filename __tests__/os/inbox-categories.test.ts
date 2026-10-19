import { describe, expect, it } from "vitest";
import { draftBlockedReason, inboxHref, inboxListView, neighbourHref } from "@/components/os/inbox/categories";
import { mockThreads } from "@/lib/os/mock";

const now = Date.now();
const view = (tab: string, over: { query?: string; selected?: string | null; drafts?: string[] } = {}) =>
  inboxListView(mockThreads(), { tab, query: over.query, draftContactIds: over.drafts ?? ["c1", "c3", "c7"], selected: over.selected ?? null, now });

describe("inbox categories", () => {
  it("has Sales · Personal · Pitches · Unsorted with draft counts on Sales only", () => {
    const v = view("sales");
    expect(v.categories.map((c) => c.label)).toEqual(["Sales", "Personal", "Pitches", "Unsorted"]);
    expect(v.categories.find((c) => c.tab === "sales")?.drafts).toBe(2);
    // A draft on a Pitches contact never counts: J never drafts there.
    expect(v.categories.find((c) => c.tab === "pitches")?.drafts).toBe(0);
    expect(v.drafts).toBe(2);
  });

  it("puts pitches in their own tab", () => {
    const rows = view("pitches").rows;
    expect(rows.map((r) => r.name)).toEqual(["growthguru_99"]);
    expect(rows[0].draft).toBe(false);
    expect(rows[0].stage).toBeNull();
  });

  it("shows the funnel stage and the draft dot on Sales rows", () => {
    const maya = view("sales").rows.find((r) => r.name === "maya.builds")!;
    expect(maya.stage).toBe("Qualify");
    expect(maya.draft).toBe(true);
    expect(maya.href).toBe("/os/inbox?tab=sales&c=m1");
  });

  it("searches name, handle and preview", () => {
    expect(view("sales", { query: "@maya" }).rows.map((r) => r.name)).toEqual(["maya.builds"]);
    expect(view("sales", { query: "40-60" }).rows).toHaveLength(1);
    expect(view("sales", { query: "nobody here" }).rows).toHaveLength(0);
  });

  it("moves J/K through the visible rows", () => {
    const rows = view("sales", { selected: "m1" }).rows;
    const i = rows.findIndex((r) => r.current);
    expect(neighbourHref(rows, 1)).toBe(rows[i + 1].href);
    expect(neighbourHref(rows, -1)).toBe(i > 0 ? rows[i - 1].href : null);
    expect(neighbourHref(view("sales").rows, 1)).toBe(rows[0].href);
    expect(inboxHref("pitches")).toBe("/os/inbox?tab=pitches");
  });

  it("explains why J can't draft", () => {
    expect(draftBlockedReason({ kind: "PITCHES", paused: false })).toMatch(/never drafts in Pitches/);
    expect(draftBlockedReason({ kind: "SALES", paused: true })).toMatch(/paused/);
    expect(draftBlockedReason({ kind: "SALES", paused: false })).toBeNull();
    expect(draftBlockedReason(null)).toMatch(/Not a contact/);
  });
});
