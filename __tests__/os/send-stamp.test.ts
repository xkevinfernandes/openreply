// Send stamps (dm-crm issue 010): every send path stamps; a human send (the
// composer, a voice note, a J draft Kevin approved) marks the thread read; an
// automated one (autopilot, broadcasts, workflow and keyword DMs) only moves
// last outbound. The database behaviour is in crm-writers.migrations.test.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const stamps = vi.hoisted(() => ({ calls: [] as { target: Record<string, unknown>; human: boolean }[] }));

vi.mock("@/lib/os/sending/cap", async (orig) => ({
  ...(await orig<typeof import("@/lib/os/sending/cap")>()),
  assertCanSend: async () => ({ sentToday: 0, cap: 80, pausedAll: false }),
  recordSend: async () => {},
}));
vi.mock("@/lib/os/workflows/hooks", () => ({ sendNotedOs: async (_w: string, _u: string, _t: string, send: () => Promise<unknown>) => send() }));
vi.mock("@/lib/meta/client", async (orig) => ({
  ...(await orig<typeof import("@/lib/meta/client")>()),
  sendDirectMessage: async () => ({ message_id: "m1" }),
  sendDirectMessageWithButton: async () => ({ message_id: "m2" }),
  sendDirectMessageWithLinkButton: async () => ({ message_id: "m3" }),
}));

import { sendReply } from "@/lib/os/inbox";
import { mockCrmState, updateMockCrmState } from "@/lib/os/mock-crm";
import { approveDraft } from "@/lib/os/setter/service";
import { newRecord, type SetterRecord } from "@/lib/os/setter/state";
import type { DraftView, SetterContact, SetterStore } from "@/lib/os/setter/store";
import { sendAudioMessage } from "@/lib/os/voice/send";

const PAST = "2026-01-01T00:00:00.000Z";
let prevMock: string | undefined;

beforeAll(() => {
  prevMock = process.env.OS_MOCK;
  process.env.OS_MOCK = "1";
});
afterAll(() => {
  if (prevMock === undefined) delete process.env.OS_MOCK;
  else process.env.OS_MOCK = prevMock;
});

function reset(contactId: string) {
  updateMockCrmState(contactId, { lastInboundAt: "2026-01-02T00:00:00.000Z", lastOutboundAt: PAST, lastOpenedAt: PAST, lastPersonalSendAt: PAST });
}

describe("the composer's text send (sendReply)", () => {
  beforeEach(() => reset("c2"));

  it("a human send stamps all three and marks the thread read", async () => {
    await sendReply("ws", "102", "hey", { conversationId: "m2", contactId: "c2", source: "manual", human: true });
    const s = mockCrmState("c2");
    expect(s.lastOutboundAt).not.toBe(PAST);
    expect(s.lastPersonalSendAt).not.toBe(PAST);
    expect(s.lastOpenedAt! > s.lastInboundAt!).toBe(true);
  });

  it("a broadcast or J's bubble only moves last outbound", async () => {
    await sendReply("ws", "102", "hey", { conversationId: "m2", contactId: "c2", source: "broadcast", human: false });
    const s = mockCrmState("c2");
    expect(s.lastOutboundAt).not.toBe(PAST);
    expect(s.lastPersonalSendAt).toBe(PAST);
    expect(s.lastOpenedAt).toBe(PAST);
  });
});

describe("voice notes", () => {
  beforeEach(() => reset("c3"));

  it("Kevin's voice note is a human send; J's recorded clip isn't", async () => {
    const base = { workspaceId: "ws", igUserId: "103", conversationId: "m3", audioId: "a", ext: "m4a", transcript: "hi", durationMs: 1000, sendKey: "k", contactId: "c3" };
    await sendAudioMessage({ ...base, human: false });
    expect(mockCrmState("c3").lastOpenedAt).toBe(PAST);
    await sendAudioMessage({ ...base, sendKey: "k2", human: true });
    expect(mockCrmState("c3").lastOpenedAt).not.toBe(PAST);
  });
});

describe("J's drafts (approveDraft)", () => {
  const contact: SetterContact = { id: "c1", workspaceId: "w1", igUserId: "101", username: "sam", conversationId: "conv1", kind: "SALES", paused: false, tags: [] };

  function store(): SetterStore {
    const states = new Map<string, SetterRecord>();
    const d: DraftView = {
      id: "d1",
      contactId: "c1",
      kind: "reply",
      anchor: "m1",
      bubbles: ["yo"],
      status: "PENDING",
      createdAt: new Date().toISOString(),
    } as DraftView;
    return {
      getContact: async () => contact,
      readThread: async () => [],
      loadState: async () => states.get("c1") ?? { ...newRecord("conv1", "sam", "c1"), their_last_at: new Date().toISOString() },
      saveState: async (_c, rec) => void states.set("c1", rec),
      pendingDraft: async () => null,
      createDraft: async () => d,
      getDraft: async () => d,
      claimDraft: async () => (d.status === "PENDING" ? ((d.status = "APPROVED"), true) : false),
      markSent: async () => void (d.status = "SENT"),
      releaseDraft: async () => {},
      discardDraft: async () => false,
      listPending: async () => [],
      send: async () => {},
      setSetterStage: async () => {},
    } as SetterStore;
  }

  it("Kevin's Approve stamps a human send; autopilot an automated one", async () => {
    const calls: { target: unknown; human: boolean }[] = [];
    const stamp = async (target: unknown, o: { human: boolean }) => void calls.push({ target, human: o.human });
    expect((await approveDraft("d1", "w1", { store: store(), gapMs: 0, stamp, hooks: null, voice: null })).error).toBeUndefined();
    expect((await approveDraft("d1", "w1", { store: store(), gapMs: 0, stamp, hooks: null, voice: null, sentBy: "autopilot" })).error).toBeUndefined();
    expect(calls).toEqual([
      { target: { contactId: "c1", workspaceId: "w1" }, human: true },
      { target: { contactId: "c1", workspaceId: "w1" }, human: false },
    ]);
  });
});

describe("keyword DMs (lib/instagram/send-messages.ts)", () => {
  it("each DM primitive stamps the recipient as an automated send, after the send", async () => {
    vi.resetModules();
    vi.doMock("@/lib/os/send-stamp", () => ({ stampSend: async (target: Record<string, unknown>, o: { human: boolean }) => void stamps.calls.push({ target, human: o.human }) }));
    const sm = await import("@/lib/instagram/send-messages");
    const context = { provider: "META", accessToken: "t" } as const;
    await sm.sendDirectMessage({ context, instagramAccountId: "ig1", userId: "u1", message: "hi" });
    await sm.sendDirectMessageWithButton({ context, instagramAccountId: "ig1", userId: "u2", text: "hi", buttonTitle: "ok", payload: "p" });
    await sm.sendDirectMessageWithLinkButton({ context, instagramAccountId: "ig1", userId: "u3", text: "hi", buttons: [{ title: "go", url: "https://x.co" }] });
    expect(stamps.calls).toEqual(["u1", "u2", "u3"].map((u) => ({ target: { instagramId: "ig1", igUserId: u }, human: false })));
    vi.doUnmock("@/lib/os/send-stamp");
  });
});
