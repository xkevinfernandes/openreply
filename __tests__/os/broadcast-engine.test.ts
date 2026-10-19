// The whole Follow-up Friday loop on the sample store: save the link → J
// drafts → nothing schedules or sends without Approve → human times → send
// through the checks, the link alone, then the follow-up.
import { describe, expect, it } from "vitest";
import { approveMessage, editMessage, loadBuilder, saveBroadcast, scheduleRun, skipMessage, type EngineDeps } from "@/lib/os/broadcasts/engine";
import { nearDuplicate, messageText } from "@/lib/os/broadcasts/personalise";
import { nextRunDate, onTheMinute, windowBounds } from "@/lib/os/broadcasts/schedule";
import { sendBroadcastPart, type SendDeps } from "@/lib/os/broadcasts/send";
import { mockBroadcastStore } from "@/lib/os/mock-followups";
import type { BroadcastSendJob } from "@/lib/os/broadcasts/types";

const LUX = "Europe/Luxembourg";
const WS = "ws-engine";
const KEY = "follow-up-friday";
const LINK = "https://youtu.be/claude-runs-my-dms";

// The sample's times hang off the next window start; run the test an hour before it.
const runDate = nextRunDate(5, "15:00", LUX, new Date()).date;
const { start, end } = windowBounds(runDate, "10:00", "15:00", LUX);
const now = new Date(start.getTime() - 3_600_000);

const store = mockBroadcastStore();
const queued: { job: BroadcastSendJob; at: number }[] = [];
const deps: EngineDeps = {
  store,
  now,
  writerFor: async () => null,
  recent: async () => [],
  cap: async () => ({ sentToday: 38, cap: 80, pausedAll: false }),
  enqueue: async (job, at) => {
    queued.push({ job, at });
    return true;
  },
};

describe("Follow-up Friday engine", () => {
  it("saving the link drafts everyone inside the window, link alone, no twins", async () => {
    const r = await saveBroadcast(WS, KEY, { link: "youtu.be/claude-runs-my-dms" }, deps);
    expect(r).toMatchObject({ ok: true });
    const data = (await loadBuilder(WS, KEY, deps))!;
    expect(data.run?.link).toBe(LINK);
    const drafts = data.messages.filter((m) => m.status === "drafted");
    const outside = data.messages.filter((m) => m.status === "outside_window").map((m) => m.handle).sort();
    expect(drafts.map((m) => m.handle).sort()).toEqual(["ava.creates", "chris.makes", "jordan.ops", "maya.builds", "sam.creates", "tom.k"]);
    expect(outside).toEqual(["dev.hobby", "lena.fit", "priya.studio"]);
    // Paused (nora) and Personal (alex) never appear.
    expect(data.audience.excluded.map((e) => e.handle).sort()).toEqual(["alex.friend", "nora.coaching"]);
    for (const m of drafts) {
      expect(m.bubbles.at(-1)).toBe(LINK);
      expect(m.text.some((t) => t.includes("http"))).toBe(false);
      expect(m.scheduledAt && new Date(m.scheduledAt) > start && new Date(m.scheduledAt) < end).toBe(true);
    }
    const texts = drafts.map((m) => messageText(m.text, m.followupBubbles));
    for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) expect(nearDuplicate(texts[i], texts[j])).toBe(false);
    expect(drafts.find((m) => m.handle === "maya.builds")?.context).toMatch(/^Live/);
    expect(drafts.find((m) => m.handle === "ava.creates")?.context).toMatch(/^Quiet/);
  });

  it("nothing schedules or sends without Approve", async () => {
    expect(await scheduleRun(WS, KEY, deps)).toEqual({ ok: false, error: "Approve at least one message first." });
    const data = (await loadBuilder(WS, KEY, deps))!;
    const draft = data.messages.find((m) => m.status === "drafted")!;
    const sent: string[] = [];
    const r = await sendBroadcastPart({ messageId: draft.id, part: "main" }, {}, { store, now, sendBubble: async (_w, _c, t) => void sent.push(t), cap: deps.cap });
    expect(r.status).toBe("stale");
    expect(sent).toEqual([]);
  });

  it("an edit can't make a twin, and needs a fresh approve", async () => {
    const data = (await loadBuilder(WS, KEY, deps))!;
    const [a, b] = data.messages.filter((m) => m.status === "drafted");
    expect(await editMessage(WS, b.id, { text: a.text.join("\n"), followup: a.followupBubbles.join("\n") }, deps)).toMatchObject({ ok: false });
    expect(await approveMessage(WS, a.id, deps)).toEqual({ ok: true });
    expect(await editMessage(WS, a.id, { text: "btw this one is basically your DM pile https://other.example/x" }, deps)).toEqual({ ok: true });
    const after = (await store.getMessage(a.id))!;
    expect(after.status).toBe("drafted");
    expect(after.edited).toBe(true);
    expect(after.bubbles).toEqual(["btw this one is basically your DM pile", LINK]);
  });

  it("approved ones get human times inside the window, under the cap", async () => {
    const data = (await loadBuilder(WS, KEY, deps))!;
    const drafts = data.messages.filter((m) => m.status === "drafted");
    for (const m of drafts.slice(0, 4)) expect(await approveMessage(WS, m.id, deps)).toEqual({ ok: true });
    expect(await skipMessage(WS, drafts[4].id, true, deps)).toEqual({ ok: true });
    queued.length = 0;
    const r = await scheduleRun(WS, KEY, deps);
    expect(r).toMatchObject({ ok: true, scheduled: 4, capped: 0 });
    expect(queued).toHaveLength(4);
    for (const q of queued) {
      expect(q.at).toBeGreaterThan(start.getTime());
      expect(q.at).toBeLessThan(end.getTime());
      expect(onTheMinute(q.at, LUX)).toBe(false);
    }
    const times = queued.map((q) => q.at).sort();
    expect(new Set(times).size).toBe(4);
  });

  it("the send re-checks, sends text then the link alone, then queues the follow-up", async () => {
    const data = (await loadBuilder(WS, KEY, deps))!;
    const m = data.messages.find((x) => x.status === "scheduled")!;
    const at = new Date(m.scheduledAt!);
    const out: string[] = [];
    const send: SendDeps = { store, now: at, sendBubble: async (_w, _c, t) => void out.push(t), cap: deps.cap, enqueue: deps.enqueue };
    queued.length = 0;
    const r = await sendBroadcastPart({ messageId: m.id, part: "main", at: at.getTime() }, {}, send);
    expect(r.status).toBe("sent");
    expect(out.at(-1)).toBe(LINK);
    expect(out.slice(0, -1).every((t) => !t.includes("http"))).toBe(true);
    expect(queued).toHaveLength(1);
    expect(queued[0].job.part).toBe("followup");
    const delay = queued[0].at - at.getTime();
    expect(delay).toBeGreaterThanOrEqual(3 * 60_000);
    expect(delay).toBeLessThanOrEqual(9 * 60_000);
    // A stale job (the message moved) does nothing.
    const other = data.messages.find((x) => x.status === "scheduled" && x.id !== m.id)!;
    expect((await sendBroadcastPart({ messageId: other.id, part: "main", at: 1 }, {}, send)).status).toBe("stale");
  });

  it("the cap at send time and Pause all stop a send", async () => {
    const data = (await loadBuilder(WS, KEY, deps))!;
    const m = data.messages.find((x) => x.status === "scheduled")!;
    const at = new Date(m.scheduledAt!);
    const out: string[] = [];
    const full = await sendBroadcastPart({ messageId: m.id, part: "main" }, { manual: true }, { store, now: at, sendBubble: async (_w, _c, t) => void out.push(t), cap: async () => ({ sentToday: 80, cap: 80, pausedAll: false }) });
    expect(full.status).toBe("held");
    const paused = await sendBroadcastPart({ messageId: m.id, part: "main" }, { manual: true }, { store, now: at, sendBubble: async (_w, _c, t) => void out.push(t), cap: async () => ({ sentToday: 0, cap: 80, pausedAll: true }) });
    expect(paused).toMatchObject({ status: "held", reason: "Pause all is on." });
    expect(out).toEqual([]);
  });
});
