import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  emailCapture: { findFirst: vi.fn() },
  automation: { findMany: vi.fn() },
  campaignHandoff: { findMany: vi.fn() },
  campaignSetter: { findMany: vi.fn() },
}));
vi.mock("@/lib/db/client", () => ({ prisma: db }));

import { campaignHoldsSetter, holdsSetter, tapAutomationId } from "@/lib/os/automations-handoff";
import { runLabel } from "@/lib/os/followups-header";

const ev = { workspaceId: "w", instagramAccountId: "acc", igUserId: "u" };

beforeEach(() => {
  vi.clearAllMocks();
  db.emailCapture.findFirst.mockResolvedValue(null);
  db.automation.findMany.mockResolvedValue([]);
  db.campaignHandoff.findMany.mockResolvedValue([]);
  db.campaignSetter.findMany.mockResolvedValue([]);
});

describe("tapAutomationId", () => {
  it("reads OpenReply's button payloads", () => {
    expect(tapAutomationId("reveal:a1:open")).toBe("a1");
    expect(tapAutomationId("reveal:a1")).toBe("a1");
    expect(tapAutomationId("followcheck:a2")).toBe("a2");
    expect(tapAutomationId("something:else")).toBeNull();
    expect(tapAutomationId(null)).toBeNull();
  });
});

describe("holdsSetter (pure rule)", () => {
  const on = (ids: string[]) => (id: string) => ids.includes(id);
  it("holds a tap on a Setter-Off campaign, not on a Setter-On one", () => {
    expect(holdsSetter({ tapAutomationId: "a", isOn: on([]) })).toBe(true);
    expect(holdsSetter({ tapAutomationId: "a", isOn: on(["a"]) })).toBe(false);
  });
  it("holds the email answer for a Setter-Off gate", () => {
    expect(holdsSetter({ emailGateAutomationId: "a", isOn: on([]) })).toBe(true);
    expect(holdsSetter({ emailGateAutomationId: "a", isOn: on(["a"]) })).toBe(false);
  });
  it("holds a DM keyword only when every campaign it triggers is Off", () => {
    expect(holdsSetter({ keywordAutomationIds: ["a", "b"], isOn: on([]) })).toBe(true);
    expect(holdsSetter({ keywordAutomationIds: ["a", "b"], isOn: on(["b"]) })).toBe(false);
  });
  it("lets J answer anything outside a flow", () => {
    expect(holdsSetter({ keywordAutomationIds: [], isOn: on([]) })).toBe(false);
  });
});

describe("campaignHoldsSetter", () => {
  it("Setter Off (no row): a tap on its button stays with OpenReply", async () => {
    expect(await campaignHoldsSetter({ ...ev, tapPayload: "reveal:a1:open" })).toBe(true);
  });

  it("existing campaign (backfilled setterOn): J still takes the tap", async () => {
    db.campaignHandoff.findMany.mockResolvedValue([{ automationId: "a1" }]);
    expect(await campaignHoldsSetter({ ...ev, tapPayload: "reveal:a1:open" })).toBe(false);
  });

  it("a named setter (CampaignSetter, e.g. set from Knowledge) counts as on", async () => {
    db.campaignSetter.findMany.mockResolvedValue([{ automationId: "a1" }]);
    expect(await campaignHoldsSetter({ ...ev, tapPayload: "followcheck:a1" })).toBe(false);
  });

  it("their email reply to a Setter-Off gate is OpenReply's", async () => {
    db.emailCapture.findFirst.mockResolvedValue({ automationId: "a1" });
    expect(await campaignHoldsSetter({ ...ev, text: "me@x.com" })).toBe(true);
  });

  it("a DM keyword of a Setter-Off campaign is OpenReply's", async () => {
    db.automation.findMany.mockResolvedValue([{ id: "a1", keywords: ["guide"], matchAnyWord: false, wholeWordMatch: true }]);
    expect(await campaignHoldsSetter({ ...ev, text: "GUIDE pls" })).toBe(true);
    expect(await campaignHoldsSetter({ ...ev, text: "hey quick question" })).toBe(false);
  });

  it("anything else they write goes to J", async () => {
    expect(await campaignHoldsSetter({ ...ev, text: "thanks! how much is coaching?" })).toBe(false);
    expect(await campaignHoldsSetter({ ...ev, tapPayload: "not-ours" })).toBe(false);
  });

  it("never throws: on a DB error J behaves as before", async () => {
    db.emailCapture.findFirst.mockRejectedValue(new Error("down"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await campaignHoldsSetter({ ...ev, text: "x" })).toBe(false);
  });
});

describe("runLabel", () => {
  it("formats the next run date", () => {
    expect(runLabel("2026-10-23", false)).toBe("Fri 23 Oct");
    expect(runLabel("2026-10-23", true)).toBe("Today");
  });
});
