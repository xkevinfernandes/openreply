// Workflow engine, one test per scenario of docs/sp/dms/2026-10-19-workflows-spec.md
// (§5) that is engine behaviour. Fake clock, fake Zernio, fake J (harness).
import { describe, expect, it } from "vitest";
import { FOLLOW_GATE_TEXT, MAX_REPEAT_REPLIES, textOnlyOverlay } from "@/lib/os/workflows/engine";
import type { WorkflowGraph } from "@/lib/os/workflows/graph";
import { templateGraph } from "@/lib/os/workflows/templates";
import { ACCT, harness, text, type Harness } from "./workflow-harness";

const H = 3600_000;
const DAY = 24 * H;

const hold = () => templateGraph("hold_lead_magnet", { keyword: "SETTER", resource: "setter-starter" });
const sendLink = (keyword = "VAULT", resource = "script-vault") => templateGraph("send_link", { keyword, resource });

function dmTrigger(keyword: string, nodes: WorkflowGraph["nodes"], edges: WorkflowGraph["edges"], kind: "dm" | "story_reply" = "dm"): WorkflowGraph {
  return {
    version: 1,
    nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { kind, keywords: [keyword] } }, ...nodes],
    edges,
  };
}
const n = (id: string, type: WorkflowGraph["nodes"][number]["type"], data: unknown) => ({ id, type, position: { x: 0, y: 0 }, data });
const e = (from: string, fromPort: string, to: string) => ({ id: `${from}-${fromPort}`, from, fromPort, to });
const setterNode = (over: Record<string, unknown> = {}) =>
  n("setter", "setter", { goal: "book_call", leadMagnet: { mode: "hold", resources: ["setter-starter"] }, ...over });

/** Comment, then reply to the opener: the run is in the Setter step. */
async function intoSetter(h: Harness, who = "sam") {
  h.publish(hold());
  await h.comment(who, "SETTER");
  await h.wait(5 * 60_000);
  await h.dm(who, "yes please, what are you building with it?");
  return (await h.run(who))!;
}

describe("5.1 Entering", () => {
  it("E1 first comment: public reply, the opener as the private reply, then everything waits for their reply", async () => {
    const h = harness();
    h.publish(hold());
    const out = await h.comment("sam", "SETTER");
    expect(out.status).toBe("started");
    const s = h.sentTo("sam");
    expect(s.map((x) => x.via)).toEqual(["public", "private"]);
    expect(["sent you a DM 🙌", "check your DMs!", "just sent it over 👀"]).toContain(text(s[0].msg));
    expect(text(s[1].msg)).toMatch(/caught your comment/);
    const run = (await h.run("sam"))!;
    expect(run.status).toBe("waiting");
    expect(run.currentNodeId).toBe("opener");
    expect(h.j).toHaveLength(0);
    await h.dm("sam", "yes please");
    expect((await h.run("sam"))!.currentNodeId).toBe("setter");
    expect(h.j.map((r) => r.reason)).toEqual(["inbound"]);
  });

  it("E2 they never reply to the opener: nothing more is sent, the run ends Quiet after 7 days", async () => {
    const h = harness();
    h.publish(hold());
    await h.comment("sam", "SETTER");
    await h.wait(6 * DAY);
    expect((await h.run("sam"))!.status).toBe("waiting");
    await h.wait(1 * DAY + H);
    const run = (await h.run("sam"))!;
    expect(run.status).toBe("exited");
    expect(run.exit).toBe("quiet");
    expect(h.sentTo("sam")).toHaveLength(2);
  });

  it("E3 same keyword again while running: no second opener, a different public reply, a note for J and it counts toward R4", async () => {
    const h = harness();
    await intoSetter(h);
    const before = h.sentTo("sam").length;
    h.setRandom(0);
    const out = await h.comment("sam", "SETTER");
    expect(out.status).toBe("repeat");
    const s = h.sentTo("sam").slice(before);
    expect(s.map((x) => x.via)).toEqual(["public"]);
    expect(text(s[0].msg)).not.toBe(text(h.sentTo("sam")[0].msg));
    const run = (await h.run("sam"))!;
    expect(run.setter.asks).toBe(1);
    expect(run.setter.notes.join()).toMatch(/commented the keyword again/);
    await h.dm("sam", "can you send the link pls");
    expect((await h.run("sam"))!.setter.directive).toMatchObject({ kind: "release", rule: "R4", slugs: ["setter-starter"] });
  });

  it("E4 same keyword after the run finished: before 30 days the old link is re-sent once, after 30 days a new run", async () => {
    const h = harness();
    h.publish(sendLink());
    await h.comment("ann", "VAULT");
    const run = (await h.run("ann"))!;
    await h.tap("ann", `wf:${run.id}:opener:send`);
    expect((await h.run("ann"))!.status).toBe("completed");
    await h.wait(2 * DAY);
    const before = h.sentTo("ann").length;
    expect((await h.comment("ann", "VAULT")).status).toBe("resent");
    expect(h.sentTo("ann").slice(before).map((x) => text(x.msg))).toContain("https://kevin.link/vault");
    await h.wait(2 * DAY);
    expect((await h.comment("ann", "VAULT")).status).toBe("skipped");
    await h.wait(30 * DAY);
    expect((await h.comment("ann", "VAULT")).status).toBe("started");
  });

  it("E5 a different keyword while J holds the conversation: no new opener, the resource joins the hold list", async () => {
    const h = harness();
    await intoSetter(h);
    h.publish(sendLink("VAULT", "script-vault"));
    const before = h.sentTo("sam").length;
    expect((await h.comment("sam", "VAULT")).status).toBe("held");
    expect(h.sentTo("sam").length).toBe(before);
    const run = (await h.run("sam"))!;
    expect(run.workflowId).toBe("wf1");
    expect(run.setter.held).toEqual(["setter-starter", "script-vault"]);
    expect(run.setter.notes.join()).toMatch(/also asked for script-vault/);
  });

  it("E6 a different keyword before the Setter step: the new workflow waits, then E5 applies when J takes over", async () => {
    const h = harness();
    h.publish(hold());
    await h.comment("sam", "SETTER");
    h.publish(sendLink("VAULT", "script-vault"));
    expect((await h.comment("sam", "VAULT")).status).toBe("queued");
    await h.dm("sam", "yes please");
    const run = (await h.run("sam"))!;
    expect(run.currentNodeId).toBe("setter");
    expect(run.setter.held).toEqual(["setter-starter", "script-vault"]);
    expect(run.state.pending).toEqual([]);
  });

  it("E6 the waiting workflow starts once the current run ends", async () => {
    const h = harness();
    h.publish(dmTrigger("HI", [n("ask", "ask", { question: "what's your email?", saveTo: "email", validate: "email" }), n("end", "end", {})], [e("trigger", "next", "ask"), e("ask", "next", "end")]));
    h.publish(dmTrigger("VAULT", [n("m", "message", { bubbles: [{ kind: "link", resourceSlug: "script-vault" }] })], [e("trigger", "next", "m")]));
    await h.dm("ann", "HI");
    expect((await h.dm("ann", "VAULT")).runId).toBeTruthy();
    expect((await h.run("ann"))!.state.pending).toHaveLength(1);
    await h.dm("ann", "ann@example.com");
    expect(h.sentTo("ann").map((s) => text(s.msg))).toContain("https://kevin.link/vault");
  });

  it("E7 a DM keyword in the middle of a live conversation is the same as E5", async () => {
    const h = harness();
    await intoSetter(h);
    h.publish(dmTrigger("QUIZ", [n("m", "message", { bubbles: [{ kind: "link", resourceSlug: "quiz" }] })], [e("trigger", "next", "m")]));
    const out = await h.dm("sam", "QUIZ");
    expect(out.consumed).toBe(false); // J sees it in the thread and answers
    expect((await h.run("sam"))!.setter.held).toContain("quiz");
  });

  it("E8 Pitches: public reply and the Message steps only, never a Setter step", async () => {
    const h = harness();
    h.publish(hold());
    h.contact("bot", { kind: "PITCHES" });
    await h.comment("bot", "SETTER");
    await h.dm("bot", "hey bro check out my agency");
    const run = (await h.run("bot"))!;
    expect(run.status).toBe("completed");
    expect(run.exit).toBe("pitches");
    expect(h.j).toHaveLength(0);
    expect(h.sentTo("bot").map((s) => s.via)).toEqual(["public", "private"]);
  });

  it("E9 clients and Personal get a simple send: the link, no questions, no setter", async () => {
    const h = harness();
    h.publish(hold());
    h.contact("mum", { kind: "PERSONAL" });
    expect((await h.comment("mum", "SETTER")).status).toBe("simple_send");
    const s = h.sentTo("mum");
    expect(s.map((x) => x.via)).toEqual(["public", "private"]);
    expect(text(s[1].msg)).toBe("https://kevin.link/starter");
    expect(h.j).toHaveLength(0);
    h.contact("cli", { tags: ["client"] });
    expect((await h.comment("cli", "SETTER")).status).toBe("simple_send");
  });

  it("E10 a paused thread: nothing automated, a to-do for Kevin with the link", async () => {
    const h = harness();
    h.publish(hold());
    h.contact("sam", { paused: true });
    expect((await h.comment("sam", "SETTER")).status).toBe("todo");
    expect(h.sentTo("sam")).toHaveLength(0);
    expect(h.todos[0].title).toBe("commented SETTER: send the guide?");
  });

  it("E11 a story reply with the keyword: the first message is a DM, no public reply", async () => {
    const h = harness();
    h.publish(dmTrigger("GUIDE", [n("m", "message", { bubbles: [{ kind: "text", text: "glad you liked it! want the guide?" }] }), setterNode()], [e("trigger", "next", "m"), e("m", "next", "setter")], "story_reply"));
    await h.dm("sam", "GUIDE", { storyReply: true });
    expect(h.sentTo("sam").map((s) => s.via)).toEqual(["dm"]);
    // The window is open (they wrote first): the next step doesn't wait for a reply.
    expect((await h.run("sam"))!.currentNodeId).toBe("setter");
  });

  it("E11 the same message seen again as a plain DM (same id) isn't handled twice", async () => {
    const h = harness();
    h.publish(dmTrigger("GUIDE", [n("m", "message", { bubbles: [{ kind: "buttons", text: "want it?", buttons: [{ id: "y", label: "Yes" }] }] }), n("end", "end", {})], [e("trigger", "next", "m"), e("m", "button:y", "end")], "story_reply"));
    await h.dm("sam", "GUIDE", { storyReply: true, mid: "s1" });
    const again = await h.dm("sam", "GUIDE", { mid: "s1" });
    expect(again.consumed).toBe(true);
    expect((await h.run("sam"))!).toMatchObject({ status: "waiting", currentNodeId: "m" });
    expect(h.sentTo("sam")).toHaveLength(1);
  });

  it("E13 bot comments: one run per person per keyword per 24h, repeat public replies capped, Pitches get none", async () => {
    const h = harness();
    h.publish(hold());
    for (let i = 0; i < 10; i++) await h.comment("spam", "SETTER");
    expect(h.store.runs.size).toBe(1);
    expect(h.sentTo("spam").filter((s) => s.via === "public")).toHaveLength(1 + MAX_REPEAT_REPLIES);
    expect(h.sentTo("spam").filter((s) => s.via === "private")).toHaveLength(1);
    // The run ends; inside 24h the same keyword starts nothing.
    await h.engine().stopAll("wf1", [...h.store.runs.values()]);
    expect((await h.comment("spam", "SETTER")).status).toBe("skipped");
    h.contact("pitch", { kind: "PITCHES" });
    await h.comment("pitch", "SETTER");
    await h.comment("pitch", "SETTER");
    expect(h.sentTo("pitch").filter((s) => s.via === "public")).toHaveLength(1);
  });
});

describe("5.2 Inside the steps", () => {
  it("S1 a button message: typing counts as the tap", async () => {
    const h = harness();
    h.publish(sendLink());
    await h.comment("ann", "VAULT");
    expect((h.sentTo("ann")[1].msg as { buttons: unknown[] }).buttons).toHaveLength(1);
    await h.dm("ann", "send it");
    expect(h.sentTo("ann").map((s) => text(s.msg))).toContain("https://kevin.link/vault");
    expect((await h.run("ann"))!.status).toBe("completed");
  });

  const askFlow = (next: "message" | "setter") =>
    dmTrigger(
      "EMAIL",
      [
        n("ask", "ask", { question: "what's the best email for it?", saveTo: "email", validate: "email", retry: "hmm that doesn't look like an email, try again?" }),
        next === "message" ? n("m", "message", { bubbles: [{ kind: "link", resourceSlug: "setter-starter" }] }) : setterNode({ leadMagnet: { mode: "none", resources: [] } }),
      ],
      [e("trigger", "next", "ask"), e("ask", "next", next === "message" ? "m" : "setter")]
    );

  it("S2 a wrong email: one retry, then carry on without it (field left empty)", async () => {
    const h = harness();
    h.publish(askFlow("message"));
    await h.dm("bob", "EMAIL");
    await h.dm("bob", "bob at gmail");
    expect(text(h.sentTo("bob").at(-1)!.msg)).toMatch(/doesn't look like an email/);
    await h.dm("bob", "bob gmail com");
    expect(text(h.sentTo("bob").at(-1)!.msg)).toBe("https://kevin.link/starter");
    expect(h.fields.has("c_bob:email")).toBe(false);
  });

  it("S3 they refuse or ask why: no retry, no hostage; with a Setter step next J takes it", async () => {
    const h = harness();
    h.publish(askFlow("message"));
    await h.dm("bob", "EMAIL");
    await h.dm("bob", "why do you need my email?");
    expect(text(h.sentTo("bob").at(-1)!.msg)).toBe("https://kevin.link/starter");
    const h2 = harness();
    h2.publish(askFlow("setter"));
    await h2.dm("kim", "EMAIL");
    await h2.dm("kim", "rather not");
    expect((await h2.run("kim"))!.currentNodeId).toBe("setter");
    expect(h2.j.map((r) => r.reason)).toEqual(["inbound"]);
  });

  it("S4 every answer is written the moment it's captured (first name at entry, email when given)", async () => {
    const h = harness();
    h.publish(askFlow("message"));
    h.contact("bob", { fullName: "Bob Marley" });
    await h.dm("bob", "EMAIL");
    expect(h.fields.get("c_bob:first_name")).toBe("Bob");
    await h.dm("bob", "sure it's bob@marley.com");
    expect(h.fields.get("c_bob:email")).toBe("bob@marley.com");
  });

  it("S5 follows me? No: the follow-gate message, at most 2 checks, then carry on", async () => {
    const h = harness();
    h.publish(
      dmTrigger(
        "FOLLOW",
        [n("c", "condition", { rule: { kind: "follows" } }), n("yes", "message", { bubbles: [{ kind: "text", text: "here it is" }] }), n("no", "message", { bubbles: [{ kind: "text", text: "no worries, here it is anyway" }] })],
        [e("trigger", "next", "c"), e("c", "yes", "yes"), e("c", "no", "no")]
      )
    );
    h.state.follows = false;
    await h.dm("ann", "FOLLOW");
    expect(text(h.sentTo("ann").at(-1)!.msg)).toBe(FOLLOW_GATE_TEXT);
    const run = (await h.run("ann"))!;
    await h.tap("ann", `wf:${run.id}:c:followed`);
    expect(h.sentTo("ann").filter((s) => text(s.msg) === FOLLOW_GATE_TEXT)).toHaveLength(2);
    await h.tap("ann", `wf:${run.id}:c:followed`);
    expect(text(h.sentTo("ann").at(-1)!.msg)).toBe("no worries, here it is anyway");
    const h2 = harness();
    h2.publish(dmTrigger("FOLLOW", [n("c", "condition", { rule: { kind: "follows" } }), n("yes", "message", { bubbles: [{ kind: "text", text: "here it is" }] })], [e("trigger", "next", "c"), e("c", "yes", "yes")]));
    h2.state.follows = true;
    await h2.dm("ann", "FOLLOW");
    expect(text(h2.sentTo("ann").at(-1)!.msg)).toBe("here it is");
  });

  it("S6 a Randomizer assigns once per person, for good (re-entry keeps the branch)", async () => {
    const h = harness();
    const g = dmTrigger(
      "AB",
      [
        n("r", "randomizer", { branches: [{ id: "a", label: "A", weight: 1 }, { id: "b", label: "B", weight: 1 }] }),
        n("ma", "message", { bubbles: [{ kind: "text", text: "line A" }] }),
        n("mb", "message", { bubbles: [{ kind: "text", text: "line B" }] }),
      ],
      [e("trigger", "next", "r"), e("r", "branch:a", "ma"), e("r", "branch:b", "mb")]
    );
    (g.nodes[0].data as { reentry: unknown }).reentry = { mode: "always", days: 1 };
    h.publish(g);
    h.setRandom(0.9);
    await h.dm("ann", "AB");
    expect(text(h.sentTo("ann").at(-1)!.msg)).toBe("line B");
    h.setRandom(0.1);
    await h.wait(DAY + H);
    await h.dm("ann", "AB");
    expect(h.sentTo("ann").map((s) => text(s.msg))).toEqual(["line B", "line B"]);
  });

  it("S8 Go to: the run ends Replaced and the other workflow starts at its first step", async () => {
    const h = harness();
    const target = h.publish(dmTrigger("NEVER", [n("m", "message", { bubbles: [{ kind: "text", text: "welcome to the other flow" }] })], [e("trigger", "next", "m")]));
    h.publish(dmTrigger("JUMP", [n("g", "goto", { workflowId: target.id })], [e("trigger", "next", "g")]));
    await h.dm("ann", "JUMP");
    const runs = [...h.store.runs.values()];
    expect(runs.find((r) => r.workflowId === "wf2")).toMatchObject({ status: "replaced", exit: "replaced" });
    expect(runs.find((r) => r.workflowId === target.id)).toMatchObject({ status: "completed", trigger: { kind: "goto" } });
    expect(text(h.sentTo("ann").at(-1)!.msg)).toBe("welcome to the other flow");
  });
});

describe("5.3 With J", () => {
  it("J1 they reply to the opener: J takes over with the step; booked → R1 release, then exit Booked", async () => {
    const h = harness();
    const run = await intoSetter(h);
    expect(run.setter).toMatchObject({ held: ["setter-starter"], released: [], goal: "book_call" });
    await h.engine().handleBooked("c_sam");
    let r = (await h.run("sam"))!;
    expect(r.setter.directive).toMatchObject({ kind: "release", rule: "R1" });
    expect(h.j.at(-1)!.reason).toBe("timer");
    await h.engine().afterJSent("c_sam", { bubbles: ["locked in!", "by the way, here's the guide, completely forgot to send it", "https://kevin.link/starter"] });
    r = (await h.run("sam"))!;
    expect(r.setter.released).toEqual(["setter-starter"]);
    expect(r).toMatchObject({ status: "exited", exit: "booked" });
  });

  it("J2 they ask straight away: the first ask stays held, the second ask releases (R4)", async () => {
    const h = harness();
    await intoSetter(h);
    await h.dm("sam", "can you just send the link pls");
    let r = (await h.run("sam"))!;
    expect(r.setter.asks).toBe(1);
    expect(r.setter.directive ?? null).toBeNull();
    await h.dm("sam", "where's the link?");
    r = (await h.run("sam"))!;
    expect(r.setter.directive).toMatchObject({ rule: "R4", slugs: ["setter-starter"] });
    expect(r.setter.goal).toBe("book_call");
  });

  it("J3 two one-word replies in a row: R3, and the goal becomes Start a conversation", async () => {
    const h = harness();
    await intoSetter(h);
    await h.dm("sam", "ok");
    expect((await h.run("sam"))!.setter.directive ?? null).toBeNull();
    await h.dm("sam", "cool");
    const r = (await h.run("sam"))!;
    expect(r.setter.directive).toMatchObject({ rule: "R3" });
    expect(r.setter.goal).toBe("start_conversation");
  });

  it("J6 'is this a bot?': J gets told (never claim to be human, hand to Kevin)", async () => {
    const h = harness();
    await intoSetter(h);
    await h.dm("sam", "wait is this a bot?");
    expect((await h.run("sam"))!.setter.notes.join()).toMatch(/never claim to be human/);
  });

  it("J7 booked on the calendar outside the DM: exit Booked, R1 release first if still held", async () => {
    const h = harness();
    const g = hold();
    g.nodes.push(n("thanks", "end", {}));
    g.edges.push(e("setter", "exit:booked", "thanks"));
    h.publish(g);
    await h.comment("sam", "SETTER");
    await h.dm("sam", "yes");
    await h.engine().handleBooked("c_sam");
    expect((await h.run("sam"))!.status).toBe("waiting");
    await h.engine().afterJSent("c_sam", { bubbles: ["https://kevin.link/starter"] });
    expect((await h.run("sam"))!).toMatchObject({ status: "completed", currentNodeId: "thanks" });
    // Nothing held: booked leaves straight away.
    const h2 = harness();
    await intoSetter(h2);
    const r = (await h2.run("sam"))!;
    r.setter.released = ["setter-starter"];
    await h2.store.saveRun(r);
    await h2.engine().handleBooked("c_sam");
    expect((await h2.run("sam"))!).toMatchObject({ status: "exited", exit: "booked" });
  });

  it("J8 / J9 cancel, reschedule or no-show after Booked: the run stays ended, nothing is held again", async () => {
    const h = harness();
    await intoSetter(h);
    const r = (await h.run("sam"))!;
    r.setter.released = ["setter-starter"];
    await h.store.saveRun(r);
    await h.engine().handleBooked("c_sam");
    await h.engine().handleBooked("c_sam");
    await h.engine().afterJSent("c_sam", { bubbles: ["no worries, want another time?"] });
    expect([...h.store.runs.values()]).toHaveLength(1);
    expect((await h.run("sam"))!).toMatchObject({ status: "exited", exit: "booked" });
  });

  it("J10 stop / not interested / rude: exit Stopped, tagged, never messaged again by any workflow", async () => {
    const h = harness();
    await intoSetter(h);
    await h.dm("sam", "stop messaging me");
    expect((await h.run("sam"))!).toMatchObject({ status: "exited", exit: "stopped" });
    expect(h.tagLog).toContain("+stopped");
    const before = h.sentTo("sam").length;
    h.publish(sendLink());
    await h.wait(40 * DAY);
    expect((await h.comment("sam", "VAULT")).status).toBe("skipped");
    expect(h.sentTo("sam")).toHaveLength(before);
  });

  it("J10 J's exit_step(stopped) does the same", async () => {
    const h = harness();
    await intoSetter(h);
    await h.engine().afterJSent("c_sam", { bubbles: ["all good, take care"], exit: "stopped" });
    expect((await h.run("sam"))!.exit).toBe("stopped");
    expect(h.contacts.get("sam")!.tags).toContain("stopped");
  });

  it("J14 Draft mode: a release waiting for Approve keeps the step open under HUMAN_AGENT", async () => {
    const h = harness();
    await intoSetter(h);
    await h.engine().afterJSent("c_sam", { bubbles: ["what are you working on right now?"] });
    // R2 is due ~20h after their last message (we wrote last).
    await h.wait(23 * H);
    const r = (await h.run("sam"))!;
    expect(r.setter.directive).toMatchObject({ rule: "R2" });
    h.pendingDrafts.add("c_sam"); // Kevin hasn't approved it
    await h.wait(2 * H);
    expect((await h.run("sam"))!.status).toBe("waiting");
    await h.wait(6 * DAY);
    expect(h.store.events.some((x) => x.kind === "leave" && x.port === "exit:quiet")).toBe(true);
    expect((await h.run("sam"))!.status).toBe("completed");
  });
});

describe("Setter timers (R2, Q1, Quiet)", () => {
  it("R2 quiet release at a random 18–22h after their last message, inside the window; then Quiet when it closes", async () => {
    const h = harness();
    h.setRandom(0.5); // 20h
    const g = hold();
    h.publish(g);
    await h.comment("sam", "SETTER");
    await h.dm("sam", "yes");
    const lastIn = h.now.getTime();
    await h.engine().afterJSent("c_sam", { bubbles: ["quick q before I send it, what are you building?"] });
    await h.wait(19 * H);
    expect((await h.run("sam"))!.setter.directive ?? null).toBeNull();
    await h.wait(1 * H + 60_000);
    const r = (await h.run("sam"))!;
    expect(r.setter.directive).toMatchObject({ rule: "R2" });
    expect(h.j.at(-1)!.reason).toBe("timer");
    expect(new Date(r.setter.directive!.at).getTime() - lastIn).toBeGreaterThanOrEqual(20 * H);
    await h.engine().afterJSent("c_sam", { bubbles: ["oh sorry, thought I'd already sent this, here you go", "https://kevin.link/starter"] });
    await h.wait(5 * H);
    const end = (await h.run("sam"))!;
    expect(end).toMatchObject({ status: "completed", currentNodeId: "end" }); // quiet → ghosted → end
    expect(h.tagLog).toContain("+ghosted");
  });

  it("Q1 one second-resource nudge inside the window, only if set", async () => {
    const h = harness();
    const g = hold();
    (g.nodes.find((x) => x.id === "setter")!.data as { leadMagnet: unknown }).leadMagnet = { mode: "hold", resources: ["setter-starter"], second: "quiz" };
    h.publish(g);
    await h.comment("sam", "SETTER");
    await h.dm("sam", "yes");
    await h.dm("sam", "send it pls");
    await h.dm("sam", "can you send the link");
    await h.engine().afterJSent("c_sam", { bubbles: ["here you go", "https://kevin.link/starter"] });
    await h.wait(21 * H);
    const r = (await h.run("sam"))!;
    expect(r.setter.directive).toMatchObject({ kind: "nudge", slugs: ["quiz"] });
    expect(r.setter.nudged).toBe(true);
  });
});

describe("5.4 Kevin", () => {
  it("K1 Kevin replies by hand: the run and J pause, every timer stops", async () => {
    const h = harness();
    await intoSetter(h);
    await h.engine().afterJSent("c_sam", { bubbles: ["what are you building?"] });
    const out = await h.engine().handleOutbound({ workspaceId: "ws1", instagramAccountId: ACCT, igUserId: "sam", text: "hey it's Kevin, quick voice note incoming" });
    expect(out.paused).toBe(true);
    expect((await h.run("sam"))!).toMatchObject({ status: "paused", pausedReason: "you replied" });
    expect(h.contacts.get("sam")!.paused).toBe(true);
    const jBefore = h.j.length;
    await h.wait(3 * DAY);
    expect(h.j.length).toBe(jBefore);
    expect((await h.dm("sam", "thanks!")).consumed).toBe(true);
  });

  it("K2 Resume: same step, J reads what Kevin wrote, timers restart from now", async () => {
    const h = harness();
    await intoSetter(h);
    await h.engine().handleOutbound({ workspaceId: "ws1", instagramAccountId: ACCT, igUserId: "sam", text: "manual" });
    await h.wait(2 * H);
    const run = (await h.run("sam"))!;
    await h.engine().resumeRun(run);
    const r = (await h.run("sam"))!;
    expect(r).toMatchObject({ status: "waiting", currentNodeId: "setter" });
    expect(h.contacts.get("sam")!.paused).toBe(false);
    expect(h.j.at(-1)!.reason).toBe("resume");
    expect(r.waitUntil!.getTime()).toBeGreaterThan(h.now.getTime());
  });

  it("K4 Kevin sends the resource himself: it counts as released (no double send)", async () => {
    const h = harness();
    await intoSetter(h);
    await h.engine().handleOutbound({ workspaceId: "ws1", instagramAccountId: ACCT, igUserId: "sam", text: "here you go https://kevin.link/starter" });
    expect((await h.run("sam"))!.setter.released).toEqual(["setter-starter"]);
  });

  it("K5 text-only edits to a Message step not reached yet apply; other edits wait for new runs", async () => {
    const g1 = dmTrigger("HI", [n("w", "wait", { mode: "delay", minutes: 60 }), n("m", "message", { bubbles: [{ kind: "text", text: "old words" }] })], [e("trigger", "next", "w"), e("w", "next", "m")]);
    const h = harness();
    const wf = h.publish(g1);
    await h.dm("ann", "HI");
    const g2 = structuredClone(g1);
    (g2.nodes[2].data as { bubbles: { text: string }[] }).bubbles[0].text = "new words";
    h.publish(g2, { id: wf.id });
    await h.wait(61 * 60_000);
    expect(text(h.sentTo("ann").at(-1)!.msg)).toBe("new words");
    expect(textOnlyOverlay({ bubbles: [{ kind: "text", text: "a" }] }, { bubbles: [{ kind: "text", text: "a" }, { kind: "text", text: "b" }] }).bubbles).toHaveLength(1);
    expect((await h.run("ann"))!.versionId).toBe(`${wf.id}_v1`);
  });

  it("K6 a workflow turned off: no new runs; active ones end at their next Setter exit", async () => {
    const h = harness();
    const g = hold();
    g.nodes.push(n("after", "message", { bubbles: [{ kind: "text", text: "thanks for booking!" }] }));
    g.edges.push(e("setter", "exit:booked", "after"));
    h.publish(g);
    await h.comment("sam", "SETTER");
    await h.dm("sam", "yes");
    const r = (await h.run("sam"))!;
    r.setter.released = ["setter-starter"];
    await h.store.saveRun(r);
    h.store.workflows.get("wf1")!.active = false;
    await h.engine().handleBooked("c_sam");
    expect((await h.run("sam"))!).toMatchObject({ status: "exited", exit: "booked" });
    expect(h.sentTo("sam").map((s) => text(s.msg))).not.toContain("thanks for booking!");
    expect((await h.comment("ann", "SETTER")).status).toBe("skipped");
  });

  it("K6 Stop everyone now ends every live run at once", async () => {
    const h = harness();
    await intoSetter(h, "sam");
    await h.comment("ann", "SETTER");
    const stopped = await h.engine().stopAll("wf1", [...h.store.runs.values()]);
    expect(stopped).toBe(2);
    expect([...h.store.runs.values()].every((r) => r.exit === "stopped_by_kevin")).toBe(true);
  });

  it("K7 Pause all: nothing sends, runs freeze and continue after", async () => {
    const h = harness();
    h.publish(dmTrigger("HI", [n("w", "wait", { mode: "delay", minutes: 10 }), n("m", "message", { bubbles: [{ kind: "text", text: "later" }] })], [e("trigger", "next", "w"), e("w", "next", "m")]));
    await h.dm("ann", "HI");
    h.state.can = "paused";
    await h.wait(60 * 60_000);
    expect(h.sentTo("ann")).toHaveLength(0);
    expect((await h.run("ann"))!.status).toBe("waiting");
    h.state.can = "ok";
    await h.wait(16 * 60_000);
    expect(text(h.sentTo("ann").at(-1)!.msg)).toBe("later");
  });

  it("K8 the daily cap: the opener still goes, later steps wait for tomorrow (listed if the window closes first)", async () => {
    const h = harness();
    h.publish(sendLink());
    h.state.can = "cap";
    await h.comment("ann", "VAULT");
    expect(h.sentTo("ann").map((s) => s.via)).toEqual(["public", "private"]);
    const run = (await h.run("ann"))!;
    await h.tap("ann", `wf:${run.id}:opener:send`);
    expect(h.sentTo("ann")).toHaveLength(2);
    const r = (await h.run("ann"))!;
    expect(r.state.blocked).toMatch(/cap/);
    expect(r.waitUntil).toEqual(h.state.capReset);
    expect(h.todos).toHaveLength(0);
    h.state.can = "ok";
    await h.wait(15 * H);
    expect(h.sentTo("ann").map((s) => text(s.msg))).toContain("https://kevin.link/vault");
    // Window closes before the reset: listed for Kevin.
    const h2 = harness();
    h2.publish(sendLink());
    h2.state.can = "cap";
    h2.state.capReset = new Date(h2.now.getTime() + 30 * H);
    await h2.comment("bo", "VAULT");
    const r2 = (await h2.run("bo"))!;
    await h2.tap("bo", `wf:${r2.id}:opener:send`);
    expect(h2.todos[0].title).toMatch(/cap/);
  });
});

describe("5.5 Overlaps", () => {
  it("O5 a plain automation works with J off: J never drafts on its steps", async () => {
    const h = harness();
    h.publish(sendLink());
    await h.comment("ann", "VAULT");
    const out = await h.dm("ann", "send it");
    expect(out.consumed).toBe(true);
    expect(h.j).toHaveLength(0);
    expect(h.sentTo("ann").map((s) => text(s.msg))).toContain("https://kevin.link/vault");
  });

  it("O6 a failing send retries 3× with backoff, then the run is Failed with the reason", async () => {
    const h = harness();
    h.publish(dmTrigger("HI", [n("m", "message", { bubbles: [{ kind: "text", text: "hey" }] })], [e("trigger", "next", "m")]));
    const minutes = async (m: number) => {
      for (let i = 0; i < m; i++) await h.wait(60_000);
    };
    h.state.failNext = 2;
    await h.dm("ann", "HI");
    expect((await h.run("ann"))!.state.blocked).toMatch(/retrying/);
    await minutes(3);
    expect(h.sentTo("ann")).toHaveLength(1);
    expect((await h.run("ann"))!.status).toBe("completed");
    h.state.failNext = 10;
    await h.dm("bob", "HI");
    await minutes(30);
    const r = (await h.run("bob"))!;
    expect(r.status).toBe("failed");
    expect(r.failReason).toMatch(/Send failed 4 times: Zernio 500/);
  });

  it("O7 duplicate webhooks: the same comment id or message id does nothing twice", async () => {
    const h = harness();
    h.publish(hold());
    await h.comment("sam", "SETTER", { commentId: "c1" });
    expect((await h.comment("sam", "SETTER", { commentId: "c1" })).status).toBe("skipped");
    expect(h.sentTo("sam")).toHaveLength(2);
    await h.dm("sam", "yes", { mid: "m1" });
    await h.dm("sam", "yes", { mid: "m1" });
    expect(h.j).toHaveLength(1);
  });

  it("O4 a comment a live OpenReply campaign answers is left to it", async () => {
    const h = harness();
    h.publish(hold());
    h.state.campaignOwns = true;
    expect((await h.comment("sam", "SETTER")).status).toBe("skipped");
    expect(h.sentTo("sam")).toHaveLength(0);
  });
});
