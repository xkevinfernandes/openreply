import { describe, expect, it } from "vitest";
import type { RichMessage } from "@/lib/os/messages/types";
import { mayaThread, mockMediaFor, MAYA } from "@/lib/os/mock";
import {
  buildThreadRows,
  formatDuration,
  leadMagnetsByMessage,
  markSetterMessages,
  mergeMessages,
  normaliseUrl,
  sentBubbleSet,
  timeLabel,
  waveform,
  windowHoursLeft,
  type ThreadExtras,
} from "@/lib/os/messages/view";

const extras = (over: Partial<ThreadExtras> = {}): ThreadExtras => ({
  setterName: "J",
  media: Object.fromEntries(mockMediaFor(MAYA.conversationId)),
  leadMagnetByMessage: { "m1-r9": "DM Script Vault" },
  openerByAutomation: { "auto-setter": "SETTER" },
  ...over,
});

const msg = (id: string, direction: "incoming" | "outgoing", at: string, text = id, over: Partial<RichMessage> = {}): RichMessage => ({
  id,
  direction,
  fromMe: direction === "outgoing",
  at,
  parts: [{ type: "text", text }],
  reactions: [],
  seenAt: null,
  deliveryStatus: null,
  origin: direction === "outgoing" ? "api" : null,
  automationId: null,
  fromSetter: false,
  quotedMessageId: null,
  deleted: false,
  edited: false,
  refreshUrl: null,
  ...over,
});

describe("buildThreadRows on Maya's board thread", () => {
  const rows = buildThreadRows(mayaThread(), extras(), Date.now(), "UTC");
  const byId = (id: string) => rows.find((r) => r.kind === "message" && r.key === id) as Extract<(typeof rows)[number], { kind: "message" }>;

  it("puts a centred time before each burst (5 on the board)", () => {
    expect(rows.filter((r) => r.kind === "time")).toHaveLength(5);
    expect(rows[0].kind).toBe("time");
  });

  it("shows their avatar on the last bubble of a run only", () => {
    expect(byId("m1-r3").avatar).toBe(false); // the reel, then text
    expect(byId("m1-r4").avatar).toBe(true);
    expect(byId("m1-r12").avatar).toBe(false); // voice, then text
    expect(byId("m1-r13").avatar).toBe(true);
  });

  it("marks the opener with its keyword, J's runs with the setter, Seen on the latest read", () => {
    expect(byId("m1-r2").opener).toBe("SETTER");
    expect(byId("m1-r5").foot).toBeNull();
    expect(byId("m1-r6").foot).toEqual({ seen: false, setter: "J", leadMagnet: null });
    expect(byId("m1-r9").foot).toEqual({ seen: false, setter: "J", leadMagnet: "DM Script Vault" });
    expect(byId("m1-r11").foot).toEqual({ seen: true, setter: "J", leadMagnet: null });
  });

  it("carries the voice transcript and the story card", () => {
    expect(byId("m1-r12").media?.transcript).toMatch(/same two questions/);
    expect(byId("m1-r1").media?.story?.caption).toBe("Claude built my setter");
  });

  it("splits a run when the side changes without a time gap", () => {
    const t = "2026-10-19T09:00:00Z";
    const r = buildThreadRows([msg("a", "incoming", t), msg("b", "outgoing", "2026-10-19T09:01:00Z"), msg("c", "incoming", "2026-10-19T09:02:00Z")], extras({ media: {} }), Date.parse(t), "UTC");
    const m = r.filter((x) => x.kind === "message");
    expect(m.map((x) => x.kind === "message" && x.avatar)).toEqual([true, false, true]);
  });
});

describe("timeLabel", () => {
  const now = Date.parse("2026-10-19T12:00:00Z");
  it("says Today for today, else weekday and date", () => {
    expect(timeLabel("2026-10-19T08:58:00Z", now, "UTC")).toBe("Today 8:58");
    expect(timeLabel("2026-10-17T09:12:00Z", now, "UTC")).toBe("Sat 17 Oct, 9:12");
  });
  it("uses the workspace timezone", () => {
    expect(timeLabel("2026-10-19T08:58:00Z", now, "Europe/Luxembourg")).toBe("Today 10:58");
  });
  it("adds the year when it isn't this year", () => {
    expect(timeLabel("2025-12-31T23:00:00Z", now, "UTC")).toBe("Wed 31 Dec 2025, 23:00");
  });
});

describe("J marker and lead magnets", () => {
  it("marks API messages whose words a sent draft had", () => {
    const sent = sentBubbleSet([{ bubbles: ["Want the scripts I use?  free"] }, { bubbles: [], editedText: "one\n\ntwo" }]);
    const out = markSetterMessages(
      [msg("x", "outgoing", "2026-10-19T09:00:00Z", "want the scripts I use? free"), msg("y", "outgoing", "2026-10-19T09:00:00Z", "two"), msg("z", "outgoing", "2026-10-19T09:00:00Z", "mine")],
      sent
    );
    expect(out.map((m) => m.fromSetter)).toEqual([true, true, false]);
  });

  it("never marks automation openers", () => {
    const out = markSetterMessages([msg("a", "outgoing", "2026-10-19T09:00:00Z", "hi", { origin: "automation" })], new Set(["hi"]));
    expect(out[0].fromSetter).toBe(false);
  });

  it("matches a sent link to its resource however it's spelled", () => {
    expect(normaliseUrl("https://www.KevinFernandes.me/script-vault/?utm=x")).toBe("kevinfernandes.me/script-vault");
    const m = msg("l", "outgoing", "2026-10-19T09:00:00Z", "", { parts: [{ type: "link", url: "https://kevinfernandes.me/script-vault", domain: "kevinfernandes.me", title: null }] });
    expect(leadMagnetsByMessage([m], [{ name: "DM Script Vault", link: "kevinfernandes.me/script-vault/" }])).toEqual({ l: "DM Script Vault" });
  });
});

describe("helpers", () => {
  it("merges pages oldest first without duplicates", () => {
    const a = msg("1", "incoming", "2026-10-19T09:00:00Z");
    const b = msg("2", "incoming", "2026-10-19T10:00:00Z");
    expect(mergeMessages([b], [a, b]).map((m) => m.id)).toEqual(["1", "2"]);
  });
  it("formats durations, waveforms and the reply window", () => {
    expect(formatDuration(14_000)).toBe("0:14");
    expect(formatDuration(null)).toBe("");
    expect(waveform("m1-r12")).toEqual(waveform("m1-r12"));
    expect(waveform("m1-r12")).toHaveLength(25);
    const now = Date.parse("2026-10-19T12:00:00Z");
    expect(windowHoursLeft([msg("a", "incoming", "2026-10-19T09:00:00Z")], now)).toBe(21);
    expect(windowHoursLeft([msg("a", "incoming", "2026-10-17T09:00:00Z")], now)).toBe(0);
    expect(windowHoursLeft([], now)).toBeNull();
  });
});
