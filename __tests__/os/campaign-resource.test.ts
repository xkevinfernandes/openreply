import { describe, expect, it } from "vitest";
import { campaignResource, campaignStats } from "@/lib/os/automations";

const resources = [
  { id: "r1", name: "Claude Code Setter Starter" },
  { id: "r2", name: "DM Script Vault" },
];

describe("keyword → resource", () => {
  it("a CampaignResource row wins", () => {
    expect(campaignResource("a1", new Map([["a1", "r2"]]), resources, { id: "r1" })).toEqual({ id: "r2", name: "DM Script Vault", viaLink: false });
  });

  it("falls back to the resource the link resolves to", () => {
    expect(campaignResource("a1", new Map(), resources, { id: "r1" })).toEqual({ id: "r1", name: "Claude Code Setter Starter", viaLink: true });
  });

  it("a row pointing at a deleted resource falls back too; nothing → null", () => {
    expect(campaignResource("a1", new Map([["a1", "gone"]]), resources, { id: "r1" })?.viaLink).toBe(true);
    expect(campaignResource("a1", new Map(), resources, null)).toBeNull();
  });
});

describe("replied / booked per campaign", () => {
  it("counts distinct people who triggered it and went on", () => {
    const logs = [
      { automationId: "a1", instagramAccountId: "acc", commenterId: "u1" },
      { automationId: "a1", instagramAccountId: "acc", commenterId: "u1" },
      { automationId: "a1", instagramAccountId: "acc", commenterId: "u2" },
      { automationId: "a2", instagramAccountId: "acc", commenterId: "u2" },
      { automationId: "a2", instagramAccountId: "acc", commenterId: "ghost" },
    ];
    const contacts = [
      { id: "c1", instagramAccountId: "acc", igUserId: "u1" },
      { id: "c2", instagramAccountId: "acc", igUserId: "u2" },
    ];
    const events = [
      { contactId: "c1", kind: "conversation_started" },
      { contactId: "c1", kind: "conversation_started" },
      { contactId: "c1", kind: "call_booked" },
      { contactId: "c2", kind: "conversation_started" },
    ];
    const s = campaignStats(logs, contacts, events);
    expect(s.get("a1")).toEqual({ replied: 2, booked: 1 });
    expect(s.get("a2")).toEqual({ replied: 1, booked: 0 });
  });
});
