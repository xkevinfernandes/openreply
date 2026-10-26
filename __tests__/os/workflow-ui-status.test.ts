// Workflows list + builder header: Live / Off / Not published, "Unpublished
// changes", the mode labels (Approve each DM / Auto-send), and the visible
// note when a server action can't be reached (stale tab after a deploy).

import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(os)/os/automations/workflows/actions", () => ({ createWorkflowAction: async () => ({ error: "x" }) }));
import {
  callAction,
  hasUnpublishedChanges,
  MODE_LABEL,
  MODE_SHORT,
  MODE_TIP,
  onBlockedNote,
  PUBLISH_FIRST_NOTE,
  saveLabel,
  STATUS_LABEL,
  UNREACHABLE_NOTE,
  workflowStatus,
} from "@/components/os/workflows/status";
import WorkflowList, { WorkflowStatusCell } from "@/components/os/workflows/workflow-list";
import type { WorkflowRow } from "@/components/os/workflows/types";

const row = (over: Partial<WorkflowRow>): WorkflowRow => ({
  id: "wf1",
  name: "Hold the lead magnet",
  trigger: { kind: "comment", keywords: ["SETTER"] },
  mode: "draft",
  on: true,
  ab: false,
  funnel: { triggered: 0, replied: 0, leadMagnet: 0, booked: 0, showed: 0 },
  version: 3,
  unpublished: false,
  live: 0,
  ...over,
});

describe("workflow status", () => {
  it("Live = published and on, Off = published and off, Not published = never published", () => {
    expect(workflowStatus({ version: 2, on: true })).toBe("live");
    expect(workflowStatus({ version: 2, on: false })).toBe("off");
    expect(workflowStatus({ version: null, on: false })).toBe("unpublished");
    expect(workflowStatus({ version: null, on: true })).toBe("unpublished");
    expect(STATUS_LABEL).toEqual({ live: "Live", off: "Off", unpublished: "Not published" });
  });

  it("flags unpublished changes only once there's a published version", () => {
    expect(hasUnpublishedChanges({ version: 2, unpublished: true })).toBe(true);
    expect(hasUnpublishedChanges({ version: 2, unpublished: false })).toBe(false);
    expect(hasUnpublishedChanges({ version: null, unpublished: true })).toBe(false);
  });

  it("mode labels never say Draft; stored values stay draft/auto", () => {
    expect(MODE_LABEL).toEqual({ draft: "Approve each DM", auto: "Auto-send" });
    expect(MODE_SHORT).toEqual({ draft: "Approve", auto: "Auto" });
    expect(MODE_TIP.draft).toMatch(/^Approve each DM/);
    expect(MODE_TIP.auto).toMatch(/^Auto-send/);
  });

  it("builder save text says Unpublished changes, not Draft changes", () => {
    expect(saveLabel("saved", true, 2)).toBe("Unpublished changes");
    expect(saveLabel("saved", true, null)).toBe("Saved");
    expect(saveLabel("saved", false, 4)).toBe("v4");
    expect(saveLabel("saving", true, 2)).toBe("Saving…");
    expect(saveLabel("error", true, 2)).toBe("Not saved");
  });
});

describe("list rows", () => {
  it("each row shows its status, unpublished changes, and the mode with a tooltip", () => {
    const html = renderToStaticMarkup(
      h(WorkflowList, {
        rows: [
          row({ id: "a", name: "Live one", on: true, version: 3, unpublished: true }),
          row({ id: "b", name: "Off one", on: false, version: 1, mode: "auto" }),
          row({ id: "c", name: "New one", on: false, version: null, unpublished: true }),
        ],
      })
    );
    expect(html).toContain(">Status<");
    expect(html).toMatch(/data-status="live"[^>]*>.*?Live</);
    expect(html).toMatch(/data-status="off"[^>]*>.*?Off</);
    expect(html).toMatch(/data-status="unpublished"[^>]*>.*?Not published</);
    // Only the published one with a moved draft says so.
    expect(html.match(/Unpublished changes/g)).toHaveLength(1);
    expect(html).toContain(`title="${MODE_TIP.draft.replace(/'/g, "&#x27;")}"`);
    expect(html).toContain(">Approve<");
    expect(html).toContain(">Auto<");
    expect(html).not.toMatch(/>Draft</);
  });

  it("the header cell can hide the changes line", () => {
    const html = renderToStaticMarkup(h(WorkflowStatusCell, { row: { version: 2, on: true, unpublished: true }, showChanges: false }));
    expect(html).toContain("Live");
    expect(html).not.toContain("Unpublished changes");
  });
});

describe("server action errors", () => {
  it("a thrown action (stale deployment) comes back as a visible note", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await callAction(async () => {
      throw new Error('Failed to find Server Action "abc". This request might be from an older or newer deployment.');
    });
    expect(r).toEqual({ error: UNREACHABLE_NOTE });
    expect(UNREACHABLE_NOTE).toBe("Couldn't reach the app, it may have been updated. Refresh the page (⌘⇧R) and try again.");
    spy.mockRestore();
  });

  it("passes results through and lets redirects propagate", async () => {
    expect(await callAction(async () => ({ version: 2 }))).toEqual({ version: 2 });
    expect(await callAction(async () => ({ error: "Add a keyword" }))).toEqual({ error: "Add a keyword" });
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/os/automations/workflows/x;307;" });
    await expect(
      callAction(async () => {
        throw redirect;
      })
    ).rejects.toBe(redirect);
  });

  it("switching On without a published version says Publish it first", () => {
    expect(onBlockedNote(true, null)).toBe(PUBLISH_FIRST_NOTE);
    expect(PUBLISH_FIRST_NOTE).toBe("Publish it first");
    expect(onBlockedNote(true, 1)).toBeNull();
    expect(onBlockedNote(false, null)).toBeNull();
  });
});
