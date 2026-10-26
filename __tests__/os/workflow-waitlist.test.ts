// The "Waitlist + questions" template (Founder Engine): quick replies, the
// typed-answer cross-check (J's model behind a fake port), reel tracking and
// the By reel stats. Fake clock, fake Zernio, fake J (harness).
import { describe, expect, it } from "vitest";
import { QUICK_REPLY_RETRY } from "@/lib/os/workflows/engine";
import { portsOf, validateGraph, type WorkflowGraph } from "@/lib/os/workflows/graph";
import { readPickedOption } from "@/lib/os/workflows/setter-step";
import { computeStats, lastQuestions } from "@/lib/os/workflows/stats";
import { templateGraph } from "@/lib/os/workflows/templates";
import { parseMessageEvents } from "@/lib/meta/webhook";
import { normalizeZernioEvent } from "@/lib/zernio/normalize-event";
import { harness, text, type Harness } from "./workflow-harness";

const DAY = 24 * 3600_000;
const waitlist = () => templateGraph("waitlist_questions");

/** Comment FOUNDER, tap Join, give the email, tap Sure: the run waits on the role question. */
async function toRole(h: Harness, who = "ana", post = "reel1") {
  await h.comment(who, "FOUNDER", { postId: post });
  const run = (await h.run(who))!;
  await h.tap(who, `wf:${run.id}:join:join`);
  await h.dm(who, `${who}@example.com`);
  await h.tap(who, `wf:${run.id}:listed:sure`);
  return run.id;
}

/** As toRole, then tap Coach: the run waits on the revenue question. */
async function toRevenue(h: Harness, who = "ana", post = "reel1") {
  const id = await toRole(h, who, post);
  await h.tap(who, `wf:${id}:q_role:coach`);
  return id;
}

type QR = { text: string; quickReplies?: { label: string; payload: string }[] };
const field = (h: Harness, who: string, key: string) => h.fields.get(`c_${who}:${key}`);
const tagsOf = (h: Harness, who: string) => h.contacts.get(who)!.tags;
const lastSent = (h: Harness, who: string) => h.sentTo(who).at(-1)!;

describe("Waitlist + questions", () => {
  it("the template is publishable, and the questions have one port per option plus Other", () => {
    const g = waitlist();
    expect(validateGraph(g)).toEqual([]);
    const role = g.nodes.find((n) => n.id === "q_role")!;
    expect(portsOf(role)).toEqual(["reply:coach", "reply:consultant", "reply:agency", "reply:other", "other"]);
    const q = g.nodes.find((n) => n.id === "q_revenue")!;
    expect(portsOf(q)).toEqual(["reply:none", "reply:u5k", "reply:5to10", "reply:10to20", "reply:20plus", "other"]);
    expect([...lastQuestions(g)]).toEqual(["q_blocker"]);
    // No qualified tag anywhere: the revenue options carry it instead.
    expect(JSON.stringify(g)).not.toMatch(/"qualified"|revenue-5k-plus/);
  });

  it("happy path: join, email, Coach, both questions by tap and typed label, wrap-up, done", async () => {
    const h = harness();
    h.publish(waitlist());
    const out = await h.comment("ana", "FOUNDER", { postId: "reel1" });
    expect(out.status).toBe("started");
    // Entry: where they came from. Not on the waitlist until there's an email.
    expect(tagsOf(h, "ana")).not.toContain("waitlist-founder-engine");
    expect(field(h, "ana", "lead_magnet")).toBeUndefined();
    expect(field(h, "ana", "source_post")).toBe("reel1");
    expect(field(h, "ana", "source_keyword")).toBe("founder");
    const opener = h.sentTo("ana").map((s) => s.via);
    expect(opener).toEqual(["public", "private"]);
    expect(text(lastSent(h, "ana").msg)).toMatch(/Founder Engine mini-series/);

    const run = (await h.run("ana"))!;
    await h.tap("ana", `wf:${run.id}:join:join`);
    expect(text(lastSent(h, "ana").msg)).toMatch(/best email address/);
    expect(tagsOf(h, "ana")).not.toContain("waitlist-founder-engine");
    await h.dm("ana", "sure it's ana@example.com");
    expect(field(h, "ana", "email")).toBe("ana@example.com");
    expect(tagsOf(h, "ana")).toContain("waitlist-founder-engine");
    expect(field(h, "ana", "lead_magnet")).toBe("Founder Engine Mini-Series");
    expect(text(lastSent(h, "ana").msg)).toMatch(/You're on the early-access list/);

    await h.tap("ana", `wf:${run.id}:listed:sure`);
    const q0 = lastSent(h, "ana").msg as QR;
    expect(q0.text).toMatch(/what do you do/);
    expect(q0.quickReplies!.map((x) => x.label)).toEqual(["Coach", "Consultant", "Agency owner", "Something else"]);
    await h.tap("ana", `wf:${run.id}:q_role:coach`);
    expect(field(h, "ana", "business")).toBe("Coach");

    const q1 = lastSent(h, "ana").msg as QR;
    expect(q1.text).toMatch(/revenue/);
    expect(q1.quickReplies!.map((x) => x.label)).toEqual(["Not earning yet", "Under $5K", "$5K–$10K", "$10K–$20K", "$20K+"]);
    expect(q1.quickReplies![3].payload).toBe(`wf:${run.id}:q_revenue:10to20`);

    await h.tap("ana", `wf:${run.id}:q_revenue:10to20`);
    expect(field(h, "ana", "monthly_revenue")).toBe("$10K–$20K");
    expect(text(lastSent(h, "ana").msg)).toMatch(/biggest thing holding/);

    await h.dm("ana", "getting LEADS");
    expect(field(h, "ana", "their_challenge")).toBe("Getting leads");
    expect(h.picks).toEqual([]); // exact labels never reach the model
    expect(tagsOf(h, "ana")).toContain("qual-complete");
    expect(tagsOf(h, "ana")).not.toContain("qualified");
    expect(tagsOf(h, "ana")).not.toContain("revenue-5k-plus");
    expect(text(lastSent(h, "ana").msg)).toMatch(/^Amazing, thanks!/);
    const done = (await h.run("ana"))!;
    expect(done.status).toBe("completed");
    expect(h.j).toHaveLength(0);
  });

  it("Something else: asks what they do, saves it to business, then the revenue question", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await toRole(h);
    await h.tap("ana", `wf:${id}:q_role:other`);
    expect((await h.run("ana"))!.currentNodeId).toBe("ask_role");
    expect(text(lastSent(h, "ana").msg)).toMatch(/What is it that you do\?/);
    await h.dm("ana", "I run a design agency");
    expect(field(h, "ana", "business")).toBe("I run a design agency");
    expect((await h.run("ana"))!.currentNodeId).toBe("q_revenue");
    expect((lastSent(h, "ana").msg as QR).text).toMatch(/revenue/);
  });

  it("a typed role that matches nothing twice is saved and goes on to the revenue question", async () => {
    const h = harness();
    h.publish(waitlist());
    await toRole(h);
    await h.dm("ana", "banana");
    expect(text(lastSent(h, "ana").msg)).toBe(QUICK_REPLY_RETRY);
    await h.dm("ana", "a bit of everything");
    expect(field(h, "ana", "business")).toBe("a bit of everything");
    expect((await h.run("ana"))!.currentNodeId).toBe("q_revenue");
  });

  it("under $5K: finishes the questions, qual-complete, no qualified tag", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await toRevenue(h);
    await h.tap("ana", `wf:${id}:q_revenue:u5k`);
    await h.tap("ana", `wf:${id}:q_blocker:scale`);
    expect(field(h, "ana", "monthly_revenue")).toBe("Under $5K");
    expect(field(h, "ana", "their_challenge")).toBe("Delivering at scale");
    expect(tagsOf(h, "ana")).toContain("qual-complete");
    expect(tagsOf(h, "ana")).not.toContain("qualified");
    expect((await h.run("ana"))!.status).toBe("completed");
  });

  it("typed answers: the label (any case, any spaces) counts as the tap; otherwise J's model picks the option", async () => {
    const h = harness();
    h.publish(waitlist());
    await toRevenue(h);
    await h.dm("ana", "  under $5k ");
    expect(field(h, "ana", "monthly_revenue")).toBe("Under $5K");
    expect(h.picks).toEqual([]);

    const h2 = harness();
    h2.publish(waitlist());
    h2.setPicker((t, options) => (/7 grand/.test(t) ? (options.find((o) => o.label === "$5K–$10K")?.id ?? null) : null));
    await toRevenue(h2, "ben");
    await h2.dm("ben", "about 7 grand a month give or take");
    expect(h2.picks).toEqual(["about 7 grand a month give or take"]);
    expect(field(h2, "ben", "monthly_revenue")).toBe("$5K–$10K");
    expect(tagsOf(h2, "ben")).not.toContain("qualified");
    expect(text(lastSent(h2, "ben").msg)).toMatch(/biggest thing holding/);
    // No first-option default: nothing else was sent in between.
    expect(h2.sentTo("ben").filter((s) => text(s.msg) === QUICK_REPLY_RETRY)).toHaveLength(0);
  });

  it("a miss gets one retry with the same chips; a second miss saves what they typed and leaves by Other (the first option's arrow)", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await toRevenue(h);
    await h.dm("ana", "banana");
    const retry = lastSent(h, "ana").msg as QR;
    expect(retry.text).toBe(QUICK_REPLY_RETRY);
    expect(retry.quickReplies!.map((x) => x.payload)).toEqual(["none", "u5k", "5to10", "10to20", "20plus"].map((o) => `wf:${id}:q_revenue:${o}`));
    expect((await h.run("ana"))!.currentNodeId).toBe("q_revenue");
    await h.dm("ana", "depends on the month really");
    expect(field(h, "ana", "monthly_revenue")).toBe("depends on the month really");
    const run = (await h.run("ana"))!;
    expect(run.currentNodeId).toBe("q_blocker");
    expect(h.store.events.some((e) => e.nodeId === "q_revenue" && e.kind === "leave" && e.port === "other")).toBe(true);
    expect(h.picks).toEqual(["banana", "depends on the month really"]);
  });

  it("a tap after the retry still counts", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await toRevenue(h);
    await h.dm("ana", "hmm");
    await h.tap("ana", `wf:${id}:q_revenue:20plus`);
    expect(field(h, "ana", "monthly_revenue")).toBe("$20K+");
    expect((await h.run("ana"))!.currentNodeId).toBe("q_blocker");
  });

  it("a refusal leaves without saving and without a retry", async () => {
    const h = harness();
    h.publish(waitlist());
    await toRevenue(h);
    await h.dm("ana", "I'd rather skip that one");
    expect(field(h, "ana", "monthly_revenue")).toBeUndefined();
    expect(h.sentTo("ana").some((s) => text(s.msg) === QUICK_REPLY_RETRY)).toBe(false);
    expect((await h.run("ana"))!.currentNodeId).toBe("q_blocker");
  });

  it("a wrong email gets the retry copy, and still no waitlist tag", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER", { postId: "reel1" });
    const run = (await h.run("ana"))!;
    await h.tap("ana", `wf:${run.id}:join:join`);
    await h.dm("ana", "my email is ana at example");
    expect(text(lastSent(h, "ana").msg)).toBe("Hmm, that doesn't look like an email. Can you send me an actual email address?");
    expect(tagsOf(h, "ana")).not.toContain("waitlist-founder-engine");
    await h.dm("ana", "ana@example.com");
    expect(tagsOf(h, "ana")).toContain("waitlist-founder-engine");
  });

  it("Maybe later: the run ends, they stay on the waitlist, no questions", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER", { postId: "reel1" });
    const run = (await h.run("ana"))!;
    await h.tap("ana", `wf:${run.id}:join:join`);
    await h.dm("ana", "ana@example.com");
    const before = h.sentTo("ana").length;
    await h.dm("ana", "maybe later");
    const done = (await h.run("ana"))!;
    expect(done.status).toBe("completed");
    expect(done.currentNodeId).toBe("later");
    expect(h.sentTo("ana")).toHaveLength(before);
    expect(tagsOf(h, "ana")).toContain("waitlist-founder-engine");
    expect(field(h, "ana", "email")).toBe("ana@example.com");
  });

  it("no answer after the email: the run ends Quiet after 7 days, the email and the waitlist tag stay", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER", { postId: "reel1" });
    const run = (await h.run("ana"))!;
    await h.tap("ana", `wf:${run.id}:join:join`);
    await h.dm("ana", "ana@example.com");
    await h.wait(6 * DAY);
    expect((await h.run("ana"))!.status).toBe("waiting");
    await h.wait(1 * DAY + 60_000);
    const done = (await h.run("ana"))!;
    expect(done).toMatchObject({ status: "exited", exit: "quiet", currentNodeId: "listed" });
    expect(field(h, "ana", "email")).toBe("ana@example.com");
    expect(tagsOf(h, "ana")).toContain("waitlist-founder-engine");
  });

  it("no answer to a question (or its retry) also ends Quiet, nothing more is sent", async () => {
    const h = harness();
    h.publish(waitlist());
    await toRevenue(h);
    await h.dm("ana", "banana");
    const sent = h.sentTo("ana").length;
    await h.wait(8 * DAY);
    expect((await h.run("ana"))!).toMatchObject({ status: "exited", exit: "quiet", currentNodeId: "q_revenue" });
    expect(h.sentTo("ana")).toHaveLength(sent);
  });

  it("no email (refused): the run ends before 'you're on the list', never on the waitlist", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER");
    const run = (await h.run("ana"))!;
    await h.tap("ana", `wf:${run.id}:join:join`);
    await h.dm("ana", "nah I'd rather not");
    const done = (await h.run("ana"))!;
    expect(done).toMatchObject({ status: "completed", currentNodeId: "no_email" });
    expect(h.sentTo("ana").some((s) => /early-access list!/.test(text(s.msg)))).toBe(false);
    expect(tagsOf(h, "ana")).not.toContain("waitlist-founder-engine");
    expect(field(h, "ana", "lead_magnet")).toBeUndefined();
  });

  it("By reel: entered → email → finished → qualified (left by an option marked qualifies) per post", async () => {
    const h = harness();
    h.publish(waitlist());
    // reel1: ana $20K+, eve $5K–$10K and stops there, ben not earning, cat never gives an email.
    let id = await toRevenue(h, "ana", "reel1");
    await h.tap("ana", `wf:${id}:q_revenue:20plus`);
    await h.tap("ana", `wf:${id}:q_blocker:leads`);
    id = await toRevenue(h, "eve", "reel1");
    await h.tap("eve", `wf:${id}:q_revenue:5to10`);
    id = await toRevenue(h, "ben", "reel1");
    await h.tap("ben", `wf:${id}:q_revenue:none`);
    await h.dm("ben", "not sure");
    await h.comment("cat", "FOUNDER", { postId: "reel1" });
    // reel2: dan gives the email and stops at the revenue question; fay goes Under $5K.
    await toRevenue(h, "dan", "reel2");
    id = await toRevenue(h, "fay", "reel2");
    await h.tap("fay", `wf:${id}:q_revenue:u5k`);

    for (const who of ["ana", "eve", "ben", "dan", "fay"]) expect(tagsOf(h, who)).not.toContain("qualified");
    const runPosts = new Map([...h.store.runs.values()].map((r) => [r.id, r.trigger.postId!]));
    const events = h.store.events.map((e) => ({ ...e, port: e.port ?? null }));
    const s = computeStats(waitlist(), events, { period: "all", now: h.now, runPosts });
    expect(s.byReel).toEqual([
      { postId: "reel1", permalink: null, entered: 4, email: 3, finished: 2, qualified: 2 },
      { postId: "reel2", permalink: null, entered: 2, email: 2, finished: 0, qualified: 0 },
    ]);
    // The count follows the marked options: unmark them and nobody qualifies.
    const unmarked = waitlist();
    for (const n of unmarked.nodes) {
      const bubbles = (n.data as { bubbles?: { kind: string; options?: { qualifies?: boolean }[] }[] }).bubbles ?? [];
      for (const b of bubbles) for (const o of b.options ?? []) delete o.qualifies;
    }
    expect(computeStats(unmarked, events, { period: "all", now: h.now, runPosts }).byReel.map((r) => r.qualified)).toEqual([0, 0]);
    // Runs that didn't come from a comment aren't in it.
    expect(computeStats(waitlist(), events, { period: "all", now: h.now }).byReel).toEqual([]);
  });
});

describe("quick replies: parts", () => {
  it("validateGraph: quick replies go last, and never with buttons", () => {
    const g = (bubbles: unknown[]): WorkflowGraph => ({
      version: 1,
      nodes: [
        { id: "t", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "dm", keywords: ["HI"] } },
        { id: "m", type: "message", position: { x: 0, y: 0 }, data: { bubbles } },
      ],
      edges: [{ id: "e", from: "t", fromPort: "next", to: "m" }],
    });
    const qr = { kind: "quick_replies", text: "pick one", options: [{ id: "a", label: "A" }] };
    expect(validateGraph(g([{ kind: "text", text: "hi" }, qr]))).toEqual([]);
    expect(validateGraph(g([qr, { kind: "text", text: "hi" }])).map((p) => p.message)).toEqual(["Quick replies go in the last bubble"]);
    expect(validateGraph(g([{ kind: "buttons", text: "x", buttons: [{ id: "b", label: "B" }] }, qr])).map((p) => p.message)).toEqual(["Buttons or quick replies, not both"]);
    expect(validateGraph(g([{ ...qr, options: [{ id: "a", label: "x".repeat(21) }] }])).length).toBe(1);
  });

  it("the model's answer is only an option it was given", () => {
    expect(readPickedOption({ option: "u5k" }, ["none", "u5k"])).toBe("u5k");
    expect(readPickedOption({ option: "none" }, ["a", "b"])).toBeNull();
    expect(readPickedOption({ option: "zzz" }, ["a"])).toBeNull();
    expect(readPickedOption("nonsense", ["a"])).toBeNull();
  });

  it("Meta and Zernio webhooks: a tapped quick reply keeps its label as the text and carries the payload", () => {
    const meta = parseMessageEvents({
      object: "instagram",
      entry: [{ id: "ig1", time: 0, messaging: [{ sender: { id: "u1" }, recipient: { id: "ig1" }, message: { mid: "m1", text: "Under $5K", quick_reply: { payload: "wf:r1:q:u5k" } } }] }],
    });
    expect(meta).toEqual([{ instagramAccountId: "ig1", messageId: "m1", messageText: "Under $5K", senderId: "u1", quickReplyPayload: "wf:r1:q:u5k" }]);
    const z = normalizeZernioEvent({
      payload: {
        id: "e1",
        event: "message.received",
        account: { id: "z1", platform: "instagram" },
        message: { platformMessageId: "m2", direction: "incoming", text: "Not sure", sender: { id: "u2" } },
        metadata: { quickReplyPayload: "wf:r1:q2:unsure" },
      },
      account: { zernioAccountId: "z1", instagramId: "ig1" },
    });
    expect(parseMessageEvents(z!)[0]).toMatchObject({ messageText: "Not sure", quickReplyPayload: "wf:r1:q2:unsure" });
  });
});
