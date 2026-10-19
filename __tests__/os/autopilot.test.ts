import { describe, expect, it, vi } from "vitest";
import {
  AUTO_FLAG,
  autoDelayMs,
  autopilotAfterDraft,
  cleanApprovals,
  decideAutoSend,
  DELAY_MS,
  stageFor,
  type AutopilotDeps,
} from "../../lib/os/setter/autopilot";
import type { FunnelStage } from "../../lib/os/setter/profile";
import type { DraftView, SetterContact } from "../../lib/os/setter/store";

const FUNNEL: FunnelStage[] = [
  { key: "open", label: "Open", guidance: "g" },
  { key: "value", label: "Value", guidance: "g", autopilot: "auto" },
  { key: "qualify", label: "Qualify", guidance: "g" },
  { key: "invitation", label: "Invitation", guidance: "g", autopilot: "auto" },
];

const draft = (p: Partial<DraftView> = {}): DraftView => ({
  id: "d1",
  contactId: "c1",
  kind: "reply",
  anchor: "a",
  bubbles: ["hey"],
  status: "PENDING",
  reasoning: null,
  setterStage: "value",
  humanAgent: false,
  flags: [],
  backend: "claude",
  createdAt: "2026-10-19T10:00:00.000Z",
  setterId: "s1",
  ...p,
});

const contact = (p: Partial<SetterContact> = {}): SetterContact => ({
  id: "c1",
  workspaceId: "w1",
  igUserId: "ig",
  username: "maya",
  conversationId: "conv",
  kind: "SALES",
  paused: false,
  tags: [],
  ...p,
});

describe("autopilot: the decision", () => {
  it("maps J's stage names onto the funnel like the board", () => {
    expect(stageFor("opener", FUNNEL)?.key).toBe("open");
    expect(stageFor("bridge", FUNNEL)?.key).toBe("invitation");
    expect(stageFor("nonsense", FUNNEL)).toBeNull();
    expect(stageFor(null, FUNNEL)).toBeNull();
  });

  it("sends only at an Auto stage", () => {
    expect(decideAutoSend({ draft: draft(), contact: contact(), funnel: FUNNEL })).toEqual({ send: true, stage: "value" });
    expect(decideAutoSend({ draft: draft({ setterStage: "opener" }), contact: contact(), funnel: FUNNEL })).toMatchObject({ send: false });
    expect(decideAutoSend({ draft: draft({ setterStage: null }), contact: contact(), funnel: FUNNEL })).toMatchObject({ send: false });
  });

  it("is Approve by default: a funnel with no switches never sends", () => {
    const plain = FUNNEL.map(({ autopilot: _a, ...s }) => s);
    for (const st of ["opener", "value", "qualify", "bridge"]) expect(decideAutoSend({ draft: draft({ setterStage: st }), contact: contact(), funnel: plain }).send).toBe(false);
  });

  it("never sends in Pitches, Personal or Unsorted, nor to a paused contact", () => {
    for (const kind of ["PITCHES", "PERSONAL", "UNSORTED"] as const) expect(decideAutoSend({ draft: draft(), contact: contact({ kind }), funnel: FUNNEL }).send).toBe(false);
    expect(decideAutoSend({ draft: draft(), contact: contact({ paused: true }), funnel: FUNNEL }).send).toBe(false);
  });

  it("leaves bookings, flagged, held and handled drafts to a person", () => {
    expect(decideAutoSend({ draft: draft({ kind: "booking" }), contact: contact(), funnel: FUNNEL }).send).toBe(false);
    for (const f of ["human_agent", "price", "unqualified", "sample", "calendar_off"]) expect(decideAutoSend({ draft: draft({ flags: [f] }), contact: contact(), funnel: FUNNEL }).send).toBe(false);
    expect(decideAutoSend({ draft: draft(), contact: contact(), funnel: FUNNEL, held: true }).send).toBe(false);
    expect(decideAutoSend({ draft: draft({ status: "SENT" }), contact: contact(), funnel: FUNNEL }).send).toBe(false);
    expect(decideAutoSend({ draft: draft({ setterStage: "bridge", flags: ["invite"] }), contact: contact(), funnel: FUNNEL }).send).toBe(true);
  });

  it("waits a short random delay", () => {
    expect(autoDelayMs(() => 0)).toBe(DELAY_MS.min);
    expect(autoDelayMs(() => 1)).toBe(DELAY_MS.max);
  });

  it("counts clean approvals per stage: unedited, not auto-sent", () => {
    const rows = [
      { setterStage: "value", edited: false, flags: [] },
      { setterStage: "value", edited: true, flags: [] },
      { setterStage: "value", edited: false, flags: [AUTO_FLAG] },
      { setterStage: "opener", edited: false, flags: [] },
      { setterStage: null, edited: false, flags: [] },
    ];
    expect(cleanApprovals(rows, FUNNEL)).toEqual({ open: 1, value: 1, qualify: 0, invitation: 0 });
  });
});

describe("autopilot: the runner", () => {
  function deps(over: Partial<AutopilotDeps> = {}, state: { draft?: DraftView; funnel?: FunnelStage[] } = {}) {
    const log: string[] = [];
    const d: AutopilotDeps = {
      getContact: async () => contact(),
      getDraft: async () => ({ draft: state.draft ?? draft(), held: false }),
      funnelOf: async () => state.funnel ?? FUNNEL,
      approve: vi.fn(async () => ({})),
      logSent: vi.fn(async (e) => void log.push(`${e.draftId}:${e.stage}`)),
      sleep: vi.fn(async () => {}),
      random: () => 0.5,
      ...over,
    };
    return { d, log };
  }

  it("sends through approve after the delay and logs it", async () => {
    const { d, log } = deps();
    expect(await autopilotAfterDraft("c1", { id: "d1" }, d)).toEqual({ status: "sent", stage: "value" });
    expect(d.sleep).toHaveBeenCalledWith(autoDelayMs(() => 0.5));
    expect(d.approve).toHaveBeenCalledWith("d1", "w1");
    expect(log).toEqual(["d1:value"]);
  });

  it("does nothing at an Approve stage", async () => {
    const { d } = deps({}, { draft: draft({ setterStage: "qualify" }) });
    expect((await autopilotAfterDraft("c1", { id: "d1" }, d)).status).toBe("skipped");
    expect(d.sleep).not.toHaveBeenCalled();
    expect(d.approve).not.toHaveBeenCalled();
  });

  it("re-checks after the delay: Kevin approved, edited or flipped the switch meanwhile", async () => {
    let calls = 0;
    const { d } = deps({
      getDraft: async () => ({ draft: draft(calls++ ? { status: "SENT" } : {}), held: false }),
    });
    expect((await autopilotAfterDraft("c1", { id: "d1" }, d)).status).toBe("skipped");
    expect(d.approve).not.toHaveBeenCalled();

    let n = 0;
    const flipped = deps({ funnelOf: async () => (n++ ? FUNNEL.map((s) => ({ ...s, autopilot: undefined })) : FUNNEL) });
    expect((await autopilotAfterDraft("c1", { id: "d1" }, flipped.d)).status).toBe("skipped");
    expect(flipped.d.approve).not.toHaveBeenCalled();
  });

  it("the cap and Pause all still win: approve's error leaves the draft for Approve", async () => {
    const { d, log } = deps({ approve: async () => ({ error: "Sending is paused (Pause all). Nothing was sent." }) });
    expect(await autopilotAfterDraft("c1", { id: "d1" }, d)).toEqual({ status: "failed", reason: "Sending is paused (Pause all). Nothing was sent." });
    expect(log).toEqual([]);
  });

  it("never throws", async () => {
    const { d } = deps({ getContact: async () => Promise.reject(new Error("db down")) });
    expect(await autopilotAfterDraft("c1", { id: "d1" }, d)).toEqual({ status: "failed", reason: "db down" });
  });
});
