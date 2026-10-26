// One-off broadcasts on an in-memory store with a fake clock (dm-crm slice 5,
// seam 4): the status table, Start, Who, Messages, the three personalise
// modes, Review, Send, cancel, the link guard, Send myself, Duplicate,
// stale drafts, Redraft and "New broadcast to these N". No network, no J.
import { describe, expect, it } from "vitest";
import {
  approveAll,
  approveMessage,
  audienceOf,
  broadcastNeeds,
  cancelBroadcast,
  duplicateBroadcast,
  editMessage,
  includeAnyway,
  loadBroadcast,
  loadBroadcastList,
  makeDrafts,
  markSentByKevin,
  newBroadcastToUnsent,
  redraftWroteSince,
  reviewPlan,
  saveSteps,
  sendBroadcast,
  type EngineDeps,
} from "@/lib/os/broadcasts/engine";
import { onTheMinute, zonedInstant } from "@/lib/os/broadcasts/schedule";
import { sendBroadcastPart, type SendDeps } from "@/lib/os/broadcasts/send";
import type { BroadcastStore } from "@/lib/os/broadcasts/store";
import type { BroadcastContact, BroadcastSendJob, BroadcastView } from "@/lib/os/broadcasts/types";
import { createMemoryBroadcastStore, type MemoryBroadcasts } from "@/lib/os/mock-followups";

const LUX = "Europe/Luxembourg";
const WS = "ws-1";
const H = 3_600_000;
const TAG = "follow-up-friday";
const TAG_ID = "tag-fff";
const VAULT = "https://kevinfernandes.me/script-vault";
// Fri 30 Oct 2026, 08:00 local (UTC+1 after the clocks went back).
const NOW = new Date("2026-10-30T07:00:00Z");
// The send: Fri 30 Oct, 10:00–15:00.
const FRI = "2026-10-30";
const FRI_START = zonedInstant(FRI, "10:00", LUX);

function person(id: string, name: string, over: Partial<BroadcastContact> = {}): BroadcastContact {
  return {
    contactId: id,
    username: `${id}.builds`,
    fullName: name,
    kind: "SALES",
    paused: false,
    tags: [TAG],
    igUserId: `ig-${id}`,
    conversationId: `conv-${id}`,
    // Inside their 24h window at the window start.
    theirLastAt: new Date(FRI_START.getTime() - 3 * H).toISOString(),
    ourLastAt: new Date(FRI_START.getTime() - 4 * H).toISOString(),
    setterStage: "qualify",
    stage: null,
    notes: null,
    fields: [],
    ...over,
  };
}

function world(contacts: BroadcastContact[]) {
  const list = [...contacts];
  const store = createMemoryBroadcastStore({
    contacts: (mem: MemoryBroadcasts) => list.map((c) => ({ ...c, tags: mem.tags.has(c.contactId) ? [...mem.tags.get(c.contactId)!] : c.tags })),
    tagName: (id) => (id === TAG_ID ? TAG : ""),
  });
  const queued: { job: BroadcastSendJob; at: number }[] = [];
  const calls = { writer: [] as (string | null)[], variations: 0 };
  let now = NOW;
  let cap = { sentToday: 0, cap: 80, pausedAll: false };
  const enqueue = async (job: BroadcastSendJob, at: number) => {
    queued.push({ job, at });
    return true;
  };
  const deps = (): EngineDeps => ({
    store,
    now,
    writerFor: async (_w, _c, setterId) => {
      calls.writer.push(setterId);
      const n = calls.writer.length;
      return async () => ({ bubbles: [`hey ${["made", "built", "wrote", "shot", "put out", "drew"][n % 6]} thing number ${n} ${"for you ".repeat(n)}`], followup: [], reasoning: "used their niche" });
    },
    variationsWriter: async () => {
      calls.variations++;
      return null;
    },
    recent: async () => [],
    cap: async () => cap,
    enqueue,
    background: async (task) => task(),
    timezone: async () => LUX,
    tagName: async (_w, id) => (id === TAG_ID ? TAG : null),
  });
  const sendDeps = (at: Date, sent: string[] = []): SendDeps => ({ store, now: at, sendBubble: async (_w, _c, t) => void sent.push(t), cap: async () => cap, enqueue });
  return {
    store,
    list,
    queued,
    calls,
    deps,
    sendDeps,
    setNow: (d: Date) => (now = d),
    setCap: (c: typeof cap) => (cap = c),
  };
}

async function draftBroadcast(store: BroadcastStore, over: Partial<BroadcastView> = {}) {
  return store.create(WS, {
    key: over.key ?? "fff-30-oct",
    name: over.name ?? "Follow-up Friday · 30 Oct",
    audienceTagId: TAG_ID,
    status: "draft",
    startMode: "window",
    sendDate: FRI,
    windowStart: "10:00",
    windowEnd: "15:00",
    timezone: LUX,
    bubbles: [
      { type: "text", text: "Hey {first_name}, happy Friday." },
      { type: "link", url: VAULT, resourceId: "res-vault", label: "DM Script Vault" },
    ],
    followupTemplate: "no pressure, curious what you think",
    ...over,
  });
}

const five = () => [person("maya", "Maya"), person("tom", "Tom K"), person("jordan", "Jordan"), person("sam", "Sam Ortega"), person("ava", "Ava")];

async function runMessages(w: ReturnType<typeof world>, key: string) {
  const b = (await w.store.get(WS, key))!;
  return w.store.messages((await w.store.runOf(b.id))!.id);
}

describe("Make drafts", () => {
  it("is refused while a link bubble is empty, and with nobody tagged", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { bubbles: [{ type: "text", text: "hey" }, { type: "link", url: null }] });
    expect(await makeDrafts(WS, "fff-30-oct", w.deps())).toEqual({ ok: false, error: "Pick a resource or paste a link first." });
    const w2 = world([]);
    await draftBroadcast(w2.store);
    expect(await makeDrafts(WS, "fff-30-oct", w2.deps())).toEqual({ ok: false, error: "No one has this tag." });
  });

  it("draft → drafting → in review, one draft per person, the link its own bubble", async () => {
    const w = world(five());
    await draftBroadcast(w.store);
    const statuses: string[] = [];
    const r = await makeDrafts(WS, "fff-30-oct", {
      ...w.deps(),
      background: async (task) => {
        statuses.push((await w.store.get(WS, "fff-30-oct"))!.status);
        await task();
      },
    });
    expect(r).toEqual({ ok: true, total: 5 });
    expect(statuses).toEqual(["drafting"]);
    const page = (await loadBroadcast(WS, "fff-30-oct", w.deps()))!;
    expect(page.broadcast.status).toBe("in_review");
    expect(page.review!.items).toHaveLength(5);
    for (const m of page.review!.items) {
      expect(m.status).toBe("drafted");
      expect(m.bubbles.at(-1)).toBe(VAULT);
      expect(m.text.join(" ")).not.toContain("http");
    }
    // Per person writes as the broadcast's agent (null = the default setter).
    expect(w.calls.writer).toEqual([null, null, null, null, null]);
  });
});

describe("Who", () => {
  it("leaves out archived, spam, paused, Personal and outside the window, with counts", async () => {
    const w = world([
      ...five(),
      person("arch", "Arch", { archived: true }),
      person("spam", "Spam", { spam: true }),
      person("nora", "Nora", { paused: true }),
      person("alex", "Alex", { kind: "PERSONAL" }),
      person("old", "Old", { theirLastAt: new Date(FRI_START.getTime() - 30 * H).toISOString() }),
    ]);
    const b = await draftBroadcast(w.store);
    const who = await audienceOf(WS, b, w.deps());
    expect(who.total).toBe(10);
    expect(who.get).toHaveLength(5);
    const rows = Object.fromEntries(who.rows.map((r) => [r.label, r.n]));
    expect(rows).toMatchObject({ "Get it": 5, Archived: 1, Spam: 1, Paused: 1, "Marked Personal": 1, "Outside Instagram's 24-hour window": 1 });
  });

  it("counts above 500 people (no take: 500)", async () => {
    const many = Array.from({ length: 620 }, (_, i) => person(`p${i}`, `P${i}`, i % 10 === 0 ? { archived: true } : {}));
    const w = world(many);
    const b = await draftBroadcast(w.store);
    const who = await audienceOf(WS, b, w.deps());
    expect(who.total).toBe(620);
    expect(who.get).toHaveLength(558);
    expect(who.rows.find((r) => r.label === "Archived")?.n).toBe(62);
  });
});

describe("Personalise modes", () => {
  it("5 variations: written once, people spread evenly, link bubbles untouched", async () => {
    const people = Array.from({ length: 12 }, (_, i) => person(`v${i}`, `Vee${i}`));
    const w = world(people);
    await draftBroadcast(w.store, { personaliseMode: "variations" });
    expect((await makeDrafts(WS, "fff-30-oct", w.deps())).ok).toBe(true);
    expect(w.calls.variations).toBe(1);
    expect(w.calls.writer).toEqual([]);
    expect((await w.store.get(WS, "fff-30-oct"))!.variations).toHaveLength(5);
    const msgs = await runMessages(w, "fff-30-oct");
    expect(msgs).toHaveLength(12);
    const byVariation = new Map<string, number>();
    for (const m of msgs) {
      expect(m.bubbles.at(-1)).toBe(VAULT);
      byVariation.set(m.reasoning ?? "", (byVariation.get(m.reasoning ?? "") ?? 0) + 1);
    }
    expect(byVariation.size).toBe(5);
    const counts = [...byVariation.values()];
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("as written: no J call, {first_name} filled", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    expect(w.calls.writer).toEqual([]);
    expect(w.calls.variations).toBe(0);
    const page = (await loadBroadcast(WS, "fff-30-oct", w.deps()))!;
    const maya = page.review!.items.find((m) => m.handle === "maya.builds")!;
    expect(maya.bubbles).toEqual(["Hey Maya, happy Friday.", VAULT]);
    expect(maya.followupBubbles).toEqual(["no pressure, curious what you think"]);
  });

  it("per person writes as the broadcast's agent", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { setterId: "setter-2" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    expect(new Set(w.calls.writer)).toEqual(new Set(["setter-2"]));
  });
});

describe("editing after drafts", () => {
  it("Who/Messages/Personalise ask first and remake on confirm; Start doesn't", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    const m0 = (await runMessages(w, "fff-30-oct"))[0];
    await approveMessage(WS, m0.id, w.deps());
    const next = { bubbles: [{ type: "text" as const, text: "Hi {first_name}" }, { type: "link" as const, url: VAULT }] };

    expect(await saveSteps(WS, "fff-30-oct", next, {}, w.deps())).toEqual({ ok: false, error: "", confirm: "This remakes all 5 drafts. Your edits and approvals are lost." });
    expect((await w.store.getMessage(m0.id))!.status).toBe("approved");

    expect(await saveSteps(WS, "fff-30-oct", { windowStart: "11:00" }, {}, w.deps())).toEqual({ ok: true, remade: false });
    expect((await w.store.getMessage(m0.id))!.status).toBe("approved");

    expect(await saveSteps(WS, "fff-30-oct", next, { confirm: true }, w.deps())).toEqual({ ok: true, remade: true });
    const after = (await w.store.getMessage(m0.id))!;
    expect(after.status).toBe("drafted");
    expect(after.bubbles[0]).toMatch(/^Hi /);
  });
});

describe("Start, Review and Send", () => {
  it("nothing sends before Send; only approved drafts get times inside the window; scheduled → sending → sent", async () => {
    const w = world(five());
    await draftBroadcast(w.store);
    await makeDrafts(WS, "fff-30-oct", w.deps());
    const msgs = await runMessages(w, "fff-30-oct");
    const sent: string[] = [];
    expect((await sendBroadcastPart({ messageId: msgs[0].id, part: "main" }, {}, w.sendDeps(NOW, sent))).status).toBe("stale");
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toEqual({ ok: false, error: "Approve at least one draft." });
    for (const m of msgs.slice(0, 3)) await approveMessage(WS, m.id, w.deps());
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toMatchObject({ ok: true, scheduled: 3, capped: 0, leftOut: 0 });
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("scheduled");
    expect(w.queued).toHaveLength(3);
    const end = zonedInstant(FRI, "15:00", LUX).getTime();
    for (const q of w.queued) {
      expect(q.at).toBeGreaterThan(FRI_START.getTime());
      expect(q.at).toBeLessThan(end);
      expect(onTheMinute(q.at, LUX)).toBe(false);
    }
    expect((await runMessages(w, "fff-30-oct")).filter((m) => m.status === "drafted")).toHaveLength(2);

    const ordered = [...w.queued].sort((a, z) => a.at - z.at);
    const out: string[] = [];
    expect((await sendBroadcastPart({ ...ordered[0].job, at: ordered[0].at }, {}, w.sendDeps(new Date(ordered[0].at), out))).status).toBe("sent");
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("sending");
    expect(out.at(-1)).toBe(VAULT);
    for (const q of ordered.slice(1)) await sendBroadcastPart({ ...q.job, at: q.at }, {}, w.sendDeps(new Date(q.at)));
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("sent");
  });

  it("Now: ends at the end time today; a past end is refused; a full cap blocks", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { startMode: "now", sendDate: null, windowEnd: "15:00", personaliseMode: "as_written" });
    for (const c of w.list) c.theirLastAt = new Date(NOW.getTime() - 2 * H).toISOString();
    await makeDrafts(WS, "fff-30-oct", w.deps());
    await approveAll(WS, "fff-30-oct", w.deps());
    w.setCap({ sentToday: 80, cap: 80, pausedAll: false });
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toEqual({ ok: false, error: "Today's cap is full (80/80). Pick a window on another day." });
    w.setCap({ sentToday: 0, cap: 80, pausedAll: false });
    w.setNow(new Date("2026-10-30T15:30:00Z")); // 16:30 local, past 15:00
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toEqual({ ok: false, error: "Pick an end time later than now." });
    w.setNow(NOW);
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toMatchObject({ ok: true, scheduled: 5 });
    const end = zonedInstant(FRI, "15:00", LUX).getTime();
    for (const q of w.queued) {
      expect(q.at).toBeGreaterThan(NOW.getTime());
      expect(q.at).toBeLessThan(end);
    }
    expect((await w.store.get(WS, "fff-30-oct"))!.sendDate).toBe(FRI);
  });

  it("cap figures count planned bubbles; about N fit; extend never past 23:00", async () => {
    const w = world(five());
    const b = await draftBroadcast(w.store, { startMode: "now", sendDate: null, windowEnd: "08:30" });
    const msgs = Array.from({ length: 20 }, (_, i) => ({ id: `m${i}`, contactId: `c${i}`, bubbles: ["a", "b"], followupBubbles: ["c"], status: "approved" as const, edited: false, scheduledAt: null, sentAt: null, error: null }));
    w.setCap({ sentToday: 50, cap: 80, pausedAll: false });
    const plan = await reviewPlan(WS, b, msgs, w.deps());
    expect(plan.figures).toMatchObject({ planned: 60, left: 30, people: 20 });
    expect(plan.figures.fit).toBeLessThan(10);
    expect(plan.figures.extendTo).not.toBeNull();
    expect(plan.figures.extendTo! <= "23:00").toBe(true);
    expect(plan.label).toBe("Send 20");
    const late = await reviewPlan(WS, { ...b, windowEnd: "22:45" }, msgs, { ...w.deps(), now: new Date("2026-10-29T21:30:00Z") });
    expect(late.figures.extendTo).toBe("23:00");
  });

  it("the audience is re-checked at Send", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    await approveAll(WS, "fff-30-oct", w.deps());
    w.list[0].tags = []; // maya lost the tag
    w.list[1].archived = true; // tom archived
    w.list.push(person("new", "Newbie")); // tagged since
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toMatchObject({ ok: true, scheduled: 3, leftOut: 2, taggedSince: 1 });
    const msgs = await runMessages(w, "fff-30-oct");
    expect(msgs.find((m) => m.contactId === "maya")).toMatchObject({ status: "skipped", skipReason: "left_the_tag" });
    expect(msgs.find((m) => m.contactId === "tom")).toMatchObject({ status: "skipped", skipReason: "archived" });
  });

  it("an edit keeps the link bubble and needs a fresh approve", async () => {
    const w = world(five());
    await draftBroadcast(w.store);
    await makeDrafts(WS, "fff-30-oct", w.deps());
    const [a] = await runMessages(w, "fff-30-oct");
    await approveMessage(WS, a.id, w.deps());
    expect(await editMessage(WS, a.id, { text: "btw this is basically your DM pile https://other.example/x" }, w.deps())).toEqual({ ok: true });
    expect((await w.store.getMessage(a.id))!).toMatchObject({ status: "drafted", edited: true, bubbles: ["btw this is basically your DM pile", VAULT] });
  });
});

describe("Cancel", () => {
  it("before Send keeps the drafts", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    expect(await cancelBroadcast(WS, "fff-30-oct", w.deps())).toEqual({ ok: true, sent: 0, cancelled: 0 });
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("cancelled");
    expect((await runMessages(w, "fff-30-oct")).every((m) => m.status === "drafted")).toBe(true);
  });

  it("from sending: the rest is skipped, queued jobs and follow-ups send nothing", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    await approveAll(WS, "fff-30-oct", w.deps());
    await sendBroadcast(WS, "fff-30-oct", w.deps());
    const q = [...w.queued].sort((a, z) => a.at - z.at);
    await sendBroadcastPart({ ...q[0].job, at: q[0].at }, {}, w.sendDeps(new Date(q[0].at)));
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("sending");
    expect(await cancelBroadcast(WS, "fff-30-oct", w.deps())).toEqual({ ok: true, sent: 1, cancelled: 4 });
    const out: string[] = [];
    for (const job of q.slice(1)) expect((await sendBroadcastPart({ ...job.job, at: job.at }, {}, w.sendDeps(new Date(job.at), out))).status).toBe("stale");
    expect((await sendBroadcastPart({ messageId: q[0].job.messageId, part: "followup" }, {}, w.sendDeps(new Date(q[0].at + 5 * 60_000), out))).status).toBe("stale");
    expect(out).toEqual([]);
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("cancelled");
  });
});

describe("the link guard and Send myself", () => {
  async function earlierSend(w: ReturnType<typeof world>, ids: string[], link: string) {
    const old = await draftBroadcast(w.store, { key: "fff-23-oct", name: "Follow-up Friday · 23 Oct", sendDate: "2026-10-23", status: "sent" });
    const run = await w.store.createRun(old.id, "2026-10-23");
    for (const id of ids) await w.store.upsertMessage(run.id, WS, id, { bubbles: ["hey", link], status: "sent", sentAt: "2026-10-23T10:00:00Z" });
  }

  it("leaves out anyone sent the same normalised link before; include anyway only un-collapses", async () => {
    const w = world(five());
    await earlierSend(w, ["maya"], "https://KevinFernandes.me/script-vault/?utm_source=ig");
    const b = await draftBroadcast(w.store);
    const who = await audienceOf(WS, b, w.deps());
    expect(who.get.map((e) => e.contact.contactId)).not.toContain("maya");
    expect(who.rows.find((r) => r.label === "Already had this link")?.n).toBe(1);
    await makeDrafts(WS, "fff-30-oct", w.deps());
    let page = (await loadBroadcast(WS, "fff-30-oct", w.deps()))!;
    const maya = page.review!.items.find((m) => m.contactId === "maya")!;
    expect(maya).toMatchObject({ collapsed: true, status: "drafted", leftOutReason: "already_had_link", hadWhen: "sent 23 Oct" });
    expect(await approveAll(WS, "fff-30-oct", w.deps())).toEqual({ ok: true, approved: 4 });
    expect((await approveMessage(WS, maya.id, w.deps())).ok).toBe(false);
    await includeAnyway(WS, maya.id, true, w.deps());
    page = (await loadBroadcast(WS, "fff-30-oct", w.deps()))!;
    expect(page.review!.items.find((m) => m.contactId === "maya")).toMatchObject({ collapsed: false, status: "drafted" });
    expect(await approveMessage(WS, maya.id, w.deps())).toEqual({ ok: true });
  });

  it("Send myself skips the draft after the send, and its links count for the guard", async () => {
    const w = world(five());
    const old = await draftBroadcast(w.store, { key: "earlier", name: "Earlier", personaliseMode: "as_written" });
    await makeDrafts(WS, "earlier", w.deps());
    const [m] = await w.store.messages((await w.store.runOf(old.id))!.id);
    expect((await w.store.getMessage(m.id))!.status).toBe("drafted"); // left without sending: unchanged
    await markSentByKevin(WS, m.id, ["my own words", "https://www.kevinfernandes.me/script-vault"], w.deps());
    expect((await w.store.getMessage(m.id))!).toMatchObject({ status: "skipped", skipReason: "sent_by_kevin", sentLinks: ["https://www.kevinfernandes.me/script-vault"] });
    const b = await draftBroadcast(w.store);
    const who = await audienceOf(WS, b, w.deps());
    expect(who.hadLink.map((h) => h.entry.contact.contactId)).toEqual([m.contactId]);
  });
});

describe("Duplicate", () => {
  it("copies tag, messages (links cleared), mode, agent and timezone; next Friday counting today", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { key: "fff-23-oct", name: "Follow-up Friday · 23 Oct", sendDate: "2026-10-23", status: "sent", setterId: "setter-2", personaliseMode: "variations", variations: [["a"], ["b"]] });
    const r = await duplicateBroadcast(WS, "fff-23-oct", w.deps());
    expect(r.ok).toBe(true);
    const copy = (await w.store.get(WS, (r as { key: string }).key))!;
    expect(copy).toMatchObject({ name: "Follow-up Friday · 30 Oct", sendDate: FRI, status: "draft", audienceTagId: TAG_ID, setterId: "setter-2", personaliseMode: "variations", timezone: LUX, startMode: "window", windowStart: "10:00", windowEnd: "15:00" });
    expect(copy.variations).toEqual([["a"], ["b"]]);
    expect(copy.bubbles[1]).toEqual({ type: "link", url: null, resourceId: null, label: null });
    expect(await makeDrafts(WS, copy.key, w.deps())).toEqual({ ok: false, error: "Pick a resource or paste a link first." });
    const late = await duplicateBroadcast(WS, "fff-23-oct", { ...w.deps(), now: new Date("2026-10-30T15:30:00Z") });
    expect((await w.store.get(WS, (late as { key: string }).key))!.sendDate).toBe("2026-11-06");
    const same = await duplicateBroadcast(WS, "fff-23-oct", { ...w.deps(), now: new Date("2026-10-30T08:00:00Z") });
    expect((await w.store.get(WS, (same as { key: string }).key))!.sendDate).toBe(FRI);
  });

  it("a Now broadcast duplicates as Now with no date", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { key: "now-one", name: "Webinar replay", startMode: "now", sendDate: "2026-10-28", status: "sent" });
    const r = await duplicateBroadcast(WS, "now-one", w.deps());
    expect((await w.store.get(WS, (r as { key: string }).key))!).toMatchObject({ startMode: "now", sendDate: null, name: "Webinar replay" });
  });
});

describe("not sent: stale drafts, Redraft, New broadcast to these N", () => {
  it("skips anyone who wrote since drafting; Redraft remakes theirs back to Review", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    await approveAll(WS, "fff-30-oct", w.deps());
    await sendBroadcast(WS, "fff-30-oct", w.deps());
    w.list[1].lastInboundAt = new Date(NOW.getTime() + H).toISOString(); // tom writes after drafting
    for (const q of [...w.queued].sort((a, z) => a.at - z.at)) await sendBroadcastPart({ ...q.job, at: q.at }, {}, w.sendDeps(new Date(q.at)));
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("sent");
    const page = (await loadBroadcast(WS, "fff-30-oct", w.deps()))!;
    expect(page.notSent).toEqual([{ reason: "wrote_since_drafting", label: "Wrote since drafting", people: [{ contactId: "tom", handle: "tom.builds" }] }]);
    expect(page.progress.sent).toBe(4);

    w.setNow(new Date(NOW.getTime() + 2 * H));
    expect(await redraftWroteSince(WS, "fff-30-oct", w.deps())).toEqual({ ok: true, total: 1 });
    expect((await w.store.get(WS, "fff-30-oct"))!.status).toBe("in_review");
    const tom = (await runMessages(w, "fff-30-oct")).find((m) => m.contactId === "tom")!;
    expect(tom).toMatchObject({ status: "drafted", skipReason: null });
    await approveMessage(WS, tom.id, w.deps());
    w.queued.length = 0;
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toMatchObject({ ok: true, scheduled: 1 });
    const q = w.queued[0];
    expect((await sendBroadcastPart({ ...q.job, at: q.at }, {}, w.sendDeps(new Date(q.at)))).status).toBe("sent");
  });

  it("New broadcast to these N targets exactly the unsent, and sends by list membership", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    await approveAll(WS, "fff-30-oct", w.deps());
    w.setCap({ sentToday: 0, cap: 6, pausedAll: false }); // 3 bubbles each: 2 fit
    expect(await sendBroadcast(WS, "fff-30-oct", w.deps())).toMatchObject({ ok: true, scheduled: 2, capped: 3 });
    for (const q of w.queued) await sendBroadcastPart({ ...q.job, at: q.at }, {}, w.sendDeps(new Date(q.at)));
    const page = (await loadBroadcast(WS, "fff-30-oct", w.deps()))!;
    expect(page.notSent.map((g) => [g.reason, g.people.length])).toEqual([["cap", 3]]);
    const n = await newBroadcastToUnsent(WS, "fff-30-oct", w.deps());
    expect(n).toMatchObject({ ok: true, count: 3 });
    const fresh = (await w.store.get(WS, (n as { key: string }).key))!;
    expect(fresh.audienceTagId).toBeNull();
    expect([...fresh.contactIds].sort()).toEqual(page.notSent[0].people.map((p) => p.contactId).sort());
    expect(fresh.bubbles).toEqual((await w.store.get(WS, "fff-30-oct"))!.bubbles);

    // Sends to the list, not the tag: nobody has the tag any more.
    for (const c of w.list) {
      c.tags = [];
      c.theirLastAt = new Date(NOW.getTime() - H).toISOString();
    }
    w.setCap({ sentToday: 0, cap: 80, pausedAll: false });
    await makeDrafts(WS, fresh.key, w.deps());
    await approveAll(WS, fresh.key, w.deps());
    w.queued.length = 0;
    expect(await sendBroadcast(WS, fresh.key, w.deps())).toMatchObject({ ok: true, scheduled: 3, leftOut: 0 });
    const q = w.queued[0];
    expect((await sendBroadcastPart({ ...q.job, at: q.at }, {}, w.sendDeps(new Date(q.at)))).status).toBe("sent");
  });
});

describe("what needs Kevin and the list", () => {
  it("broadcastNeeds returns only broadcasts in review, with their draft count", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { key: "a-draft", name: "A draft" });
    await draftBroadcast(w.store, { personaliseMode: "as_written" });
    await makeDrafts(WS, "fff-30-oct", w.deps());
    const needs = await broadcastNeeds(WS, w.deps());
    expect(needs).toHaveLength(1);
    expect(needs[0]).toMatchObject({ key: "fff-30-oct", kind: "review", count: 5, href: "/os/automations/broadcasts/fff-30-oct" });
  });

  it("the list is newest first, with status and messages", async () => {
    const w = world(five());
    await draftBroadcast(w.store, { key: "older", name: "Older" });
    await draftBroadcast(w.store, { key: "newer", name: "Newer", bubbles: [{ type: "text", text: "x" }, { type: "link", url: null }] });
    const list = await loadBroadcastList(WS, w.deps());
    expect(list.map((l) => l.key)).toEqual(["newer", "older"]);
    expect(list[0]).toMatchObject({ statusLabel: "Draft", messages: "3 · pick a link", tag: TAG, personalised: "Per person" });
    expect(list[1].messages).toBe("3 · DM Script Vault");
  });
});
