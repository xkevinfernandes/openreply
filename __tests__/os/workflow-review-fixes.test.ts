// Review fixes on the workflow engine and builder: deleting a workflow, stale
// and double taps, free text at buttons / questions at an Ask, the outbound
// note written before the send (echo race), the per-run lease (a tap racing
// the timer) and "the latest trigger wins". Fake clock, fake Zernio, fake J.
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/app/(os)/os/automations/workflows/actions", () => ({ createWorkflowAction: async () => ({ error: "x" }), deleteWorkflowAction: async () => ({ stopped: 0 }) }));
import { rowFromSummary } from "@/components/os/workflows/api-map";
import { DeleteWorkflowConfirm } from "@/components/os/workflows/delete-workflow";
import { deleteConfirmText } from "@/components/os/workflows/status";
import WorkflowList from "@/components/os/workflows/workflow-list";
import type { WorkflowRow } from "@/components/os/workflows/types";
import { isQuestion, QUICK_REPLY_RETRY, RUN_BUSY_RETRY_MS } from "@/lib/os/workflows/engine";
import type { StepData } from "@/lib/os/workflows/graph";
import { memoryWorkflowStore } from "@/lib/os/workflows/memory-store";
import { sendNoted, textHash, type OutboundTable } from "@/lib/os/workflows/outbound";
import { templateGraph } from "@/lib/os/workflows/templates";
import { ACCT, harness, text, type Harness } from "./workflow-harness";

const waitlist = (keyword = "FOUNDER") => templateGraph("waitlist_questions", { keyword });
const hold = () => templateGraph("hold_lead_magnet", { keyword: "SETTER", resource: "setter-starter" });

/** Comment FOUNDER and tap Join: the run waits at the email Ask. */
async function atEmail(h: Harness, who = "ana") {
  await h.comment(who, "FOUNDER", { postId: "reel1" });
  const run = (await h.run(who))!;
  await h.tap(who, `wf:${run.id}:join:join`);
  expect((await h.run(who))!.currentNodeId).toBe("email");
  return run.id;
}

describe("stale and double taps", () => {
  it("a double Join tap at the email Ask is ignored and consumed: no retry, no wrong email, the run keeps waiting", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await atEmail(h);
    const sent = h.sentTo("ana").length;
    for (let i = 0; i < 3; i++) {
      const out = await h.tap("ana", `wf:${id}:join:join`);
      expect(out.consumed).toBe(true);
    }
    expect(h.sentTo("ana").length).toBe(sent);
    const run = (await h.run("ana"))!;
    expect([run.status, run.currentNodeId, run.state.askRetried]).toEqual(["waiting", "email", false]);
    await h.dm("ana", "ana@example.com");
    expect(h.fields.get("c_ana:email")).toBe("ana@example.com");
  });

  it("a tap naming another run is ignored", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER");
    const before = h.sentTo("ana").length;
    const out = await h.tap("ana", "wf:someOtherRun:join:join");
    expect(out.consumed).toBe(true);
    expect((await h.run("ana"))!.currentNodeId).toBe("join");
    expect(h.sentTo("ana").length).toBe(before);
  });

  it("a second tap on an answered quick reply isn't a miss (no retry chips, no model call)", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await atEmail(h);
    await h.dm("ana", "ana@example.com");
    await h.tap("ana", `wf:${id}:listed:sure`);
    await h.tap("ana", `wf:${id}:q_role:coach`);
    expect((await h.run("ana"))!.currentNodeId).toBe("q_revenue");
    const sent = h.sentTo("ana").length;
    await h.tap("ana", `wf:${id}:q_role:coach`);
    expect(h.sentTo("ana").length).toBe(sent);
    expect(h.sentTo("ana").map((s) => text(s.msg))).not.toContain(QUICK_REPLY_RETRY);
    expect(h.picks).toEqual([]);
    const run = (await h.run("ana"))!;
    expect([run.currentNodeId, run.state.askRetried]).toEqual(["q_revenue", false]);
  });
});

describe("free text at buttons, questions at an Ask", () => {
  it("free text at a buttons step keeps it waiting and reaches J; the label typed still counts as the tap", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER");
    const sent = h.sentTo("ana").length;
    const out = await h.dm("ana", "wait what is this exactly?");
    expect(out.consumed).toBe(false);
    const run = (await h.run("ana"))!;
    expect([run.status, run.currentNodeId]).toEqual(["waiting", "join"]);
    expect(h.sentTo("ana").length).toBe(sent);
    const typed = await h.dm("ana", "  join EARLY access ");
    expect(typed.consumed).toBe(true);
    expect((await h.run("ana"))!.currentNodeId).toBe("email");
  });

  it("a question at the email Ask keeps it waiting and reaches J; a real refusal still moves on", async () => {
    const h = harness();
    h.publish(waitlist());
    await atEmail(h);
    const sent = h.sentTo("ana").length;
    const out = await h.dm("ana", "is this the same as your newsletter?");
    expect(out.consumed).toBe(false);
    const run = (await h.run("ana"))!;
    expect([run.status, run.currentNodeId, run.state.askRetried]).toEqual(["waiting", "email", false]);
    expect(h.sentTo("ana").length).toBe(sent);
    await h.dm("ana", "nah rather not");
    expect((await h.run("ana"))!.currentNodeId).not.toBe("email");
    expect(h.fields.get("c_ana:email")).toBeUndefined();
  });

  it("isQuestion: ends with ? and holds no valid answer; a free-text Ask needs a question opener", () => {
    expect(isQuestion("why do you need it?", "email")).toBe(true);
    expect(isQuestion("ana@example.com?", "email")).toBe(false);
    expect(isQuestion("no thanks", "email")).toBe(false);
    expect(isQuestion("about 50k?", "number")).toBe(false);
    expect(isQuestion("how much does it cost?", "number")).toBe(true);
    expect(isQuestion("fitness coaching?", "text")).toBe(false);
    expect(isQuestion("what do you mean?", "text")).toBe(true);
  });
});

describe("the latest trigger wins", () => {
  it("a FOUNDER run at the email Ask: a FOUNDER 3 comment ends it and sends FOUNDER 3's opener; old taps do nothing", async () => {
    const h = harness();
    h.publish(waitlist("FOUNDER"));
    const oldId = await atEmail(h);
    const f3 = h.publish(waitlist("FOUNDER3"));
    const out = await h.comment("ana", "founder3", { postId: "reel3" });
    expect(out.status).toBe("started");
    const old = (await h.store.getRun(oldId))!;
    expect([old.status, old.exit]).toEqual(["exited", "replaced"]);
    const run = (await h.run("ana"))!;
    expect(run.id).not.toBe(oldId);
    expect(run.workflowId).toBe(f3.id);
    const opener = h.sentTo("ana").at(-1)!;
    expect(opener.via).toBe("private");
    expect(JSON.stringify(opener.msg)).toContain(`wf:${run.id}:join:join`);

    const sent = h.sentTo("ana").length;
    expect((await h.tap("ana", `wf:${oldId}:join:join`)).consumed).toBe(true);
    expect(h.sentTo("ana").length).toBe(sent);
    expect((await h.run("ana"))!.currentNodeId).toBe("join");
    // Its own tap works.
    await h.tap("ana", `wf:${run.id}:join:join`);
    expect((await h.run("ana"))!.currentNodeId).toBe("email");
  });

  it("the same workflow again is still a repeat (no new run)", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await atEmail(h);
    expect((await h.comment("ana", "FOUNDER")).status).toBe("repeat");
    expect((await h.run("ana"))!.id).toBe(id);
  });
});

describe("delete a workflow", () => {
  it("everyone stops where they are (paused contacts unpause), then it goes with its runs, events and branches; the keyword is free", async () => {
    const h = harness();
    const wf = h.publish(hold());
    await h.comment("sam", "SETTER");
    await h.comment("bob", "SETTER");
    const bob = (await h.run("bob"))!;
    await h.engine().pauseRun(bob, "you replied");
    expect(h.contacts.get("bob")!.paused).toBe(true);
    await h.store.assignment({ workspaceId: "ws1", workflowId: wf.id, nodeId: "r", instagramAccountId: ACCT, igUserId: "sam" }, () => "a");

    expect(await h.engine().deleteWorkflow(wf.id)).toBe(2);
    expect(h.contacts.get("bob")!.paused).toBe(false);
    expect(h.store.workflows.has(wf.id)).toBe(false);
    expect([...h.store.versionsById.values()].filter((v) => v.workflowId === wf.id)).toEqual([]);
    expect([...h.store.runs.values()].filter((r) => r.workflowId === wf.id)).toEqual([]);
    expect(h.store.events.filter((e) => e.workflowId === wf.id)).toEqual([]);
    expect([...h.store.assignments.keys()].filter((k) => k.startsWith(`${wf.id}:`))).toEqual([]);
    expect(await h.store.liveRun(ACCT, "sam")).toBeNull();

    // The keyword is free right away: a new workflow with it starts runs.
    h.publish(hold());
    expect((await h.comment("sam", "SETTER")).status).toBe("started");
  });

  it("mock adapter (OS_MOCK=1): delete removes the workflow and its runs and frees its keyword", async () => {
    const prev = process.env.OS_MOCK;
    process.env.OS_MOCK = "1";
    const g = globalThis as { __osWorkflows?: unknown };
    delete g.__osWorkflows;
    try {
      const data = await import("@/components/os/workflows/data");
      expect((await data.getWorkflow("w", "wf1"))?.live).toBe(3);
      const { id } = await data.createWorkflow("w", "send_link", "script-vault");
      const graph = (await data.getWorkflow("w", id))!.graph;
      (graph.nodes[0].data as StepData<"trigger">).keywords = ["SETTER"];
      await data.saveDraft("w", id, { graph });
      expect("problems" in (await data.publishWorkflow("w", id))).toBe(true);

      expect(await data.deleteWorkflow("w", "wf1")).toEqual({ stopped: 3 });
      expect((await data.listWorkflows("w")).map((r) => r.id)).not.toContain("wf1");
      expect(await data.contactRun("w", "c1")).toBeNull();
      expect(await data.publishWorkflow("w", id)).toEqual({ version: 1 });
      await expect(data.deleteWorkflow("w", "wf1")).rejects.toThrow(/gone/);
    } finally {
      process.env.OS_MOCK = prev;
      delete g.__osWorkflows;
    }
  });

  it("the confirm says who stops; it's inline (no browser confirm())", () => {
    expect(deleteConfirmText("Founder Engine", 4)).toBe("Delete Founder Engine? 4 people are in it right now; they stop where they are.");
    expect(deleteConfirmText("X", 1)).toBe("Delete X? 1 person is in it right now; they stop where they are.");
    expect(deleteConfirmText("X", 0)).toBe("Delete X? Nobody is in it right now.");
    const html = renderToStaticMarkup(h(DeleteWorkflowConfirm, { id: "wf1", name: "Founder Engine", live: 2, onCancel: () => {}, onDeleted: () => {} }));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain("Delete Founder Engine? 2 people are in it right now; they stop where they are.");
    expect(html).toContain(">Cancel<");
  });

  it("each list row has a ⋯ menu; live counts come from active + paused runs", () => {
    const row: WorkflowRow = { id: "wf1", name: "Hold", trigger: { kind: "comment", keywords: ["SETTER"] }, mode: "draft", on: true, ab: false, funnel: { triggered: 0, replied: 0, leadMagnet: 0, booked: 0, showed: 0 }, version: 1, unpublished: false, live: 2 };
    const html = renderToStaticMarkup(h(WorkflowList, { rows: [row] }));
    expect(html).toContain('aria-label="More for Hold"');
    const summary = { id: "a", name: "A", mode: "draft" as const, active: true, trigger: null, version: 1, unpublished: false, runs: { active: 3, paused: 1, failed: 2, total: 9 }, updatedAt: "" };
    expect(rowFromSummary(summary, null, false).live).toBe(4);
  });
});

describe("echo race: the outbound note goes in before the send", () => {
  function fakeTable() {
    const log: string[] = [];
    const t: OutboundTable = {
      async create({ data }) {
        log.push(`note:${data.hash}`);
        return { id: "o1" };
      },
      async deleteMany({ where }) {
        log.push(`unnote:${where.id}`);
      },
    };
    return { log, t };
  }

  it("notes, then sends", async () => {
    const { log, t } = fakeTable();
    const r = await sendNoted("ws", "u1", "Hello  there", async () => {
      log.push("send");
      return 7;
    }, t);
    expect(r).toBe(7);
    expect(log).toEqual([`note:${textHash("hello there")}`, "send"]);
  });

  it("a failed send takes its note back out and the error goes on", async () => {
    const { log, t } = fakeTable();
    await expect(sendNoted("ws", "u1", "hi", async () => {
      log.push("send");
      throw new Error("Zernio 500");
    }, t)).rejects.toThrow("Zernio 500");
    expect(log).toEqual([`note:${textHash("hi")}`, "send", "unnote:o1"]);
  });

  it("a note that can't be written never blocks the send", async () => {
    const t: OutboundTable = { create: async () => Promise.reject(new Error("db down")), deleteMany: async () => undefined };
    expect(await sendNoted("ws", "u1", "hi", async () => "ok", t)).toBe("ok");
  });
});

describe("one pass per run at a time (the run lease)", () => {
  it("memory store: a held lease blocks, unlock or expiry frees it", async () => {
    const s = memoryWorkflowStore();
    const t1 = await s.lockRun("r1", 60_000);
    expect(t1).toBeTruthy();
    expect(await s.lockRun("r1", 60_000)).toBeNull();
    await s.unlockRun("r1", "not-mine");
    expect(await s.lockRun("r1", 60_000)).toBeNull();
    await s.unlockRun("r1", t1!);
    const t2 = await s.lockRun("r1", -1);
    expect(t2).toBeTruthy();
    expect(await s.lockRun("r1", 60_000)).toBeTruthy();
  });

  it("a timer that fires while a tap is mid-step leaves the run alone and looks again later; the tap's progress stands", async () => {
    const h = harness();
    h.publish(waitlist());
    const id = await atEmail(h);
    await h.dm("ana", "ana@example.com");
    await h.tap("ana", `wf:${id}:listed:sure`);
    await h.tap("ana", `wf:${id}:q_role:coach`);
    expect((await h.run("ana"))!.currentNodeId).toBe("q_revenue");

    // J's model is slow on a typed answer: the tap holds the run meanwhile.
    let release!: (v: string | null) => void;
    let entered!: () => void;
    const inside = new Promise<void>((r) => (entered = r));
    h.ports.pickOption = () => {
      entered();
      return new Promise((r) => (release = r));
    };
    const reply = h.dm("ana", "around seven grand a month");
    await inside;
    const scheduled = h.scheduled.length;
    // Its timer comes due now: without the lease, the tick would end the run
    // Quiet at the question, and the tap's save would then bring it back.
    const due = (await h.store.getRun(id))!;
    due.waitUntil = h.now;
    await h.store.saveRun(due);
    await h.engine().tick(id);
    expect(h.scheduled.length).toBeGreaterThan(scheduled);
    expect(h.scheduled.at(-1)!.at.getTime()).toBe(h.now.getTime() + RUN_BUSY_RETRY_MS);
    const mid = (await h.store.getRun(id))!;
    expect([mid.status, mid.currentNodeId, mid.exit]).toEqual(["waiting", "q_revenue", null]);
    expect(h.store.events.filter((e) => e.runId === id && e.kind === "leave" && e.port === "exit:quiet")).toEqual([]);
    release("5to10");
    await reply;
    const run = (await h.store.getRun(id))!;
    expect(run.exit).toBeNull();
    expect(run.currentNodeId).not.toBe("q_revenue");
  });

  it("a tap waits for a held lease, then goes on", async () => {
    const h = harness();
    h.publish(waitlist());
    await h.comment("ana", "FOUNDER");
    const run = (await h.run("ana"))!;
    const token = (await h.store.lockRun(run.id, 60_000))!;
    let done = false;
    const tap = h.tap("ana", `wf:${run.id}:join:join`).then(() => (done = true));
    await new Promise((r) => setTimeout(r, 250));
    expect(done).toBe(false);
    expect((await h.store.getRun(run.id))!.currentNodeId).toBe("join");
    await h.store.unlockRun(run.id, token);
    await tap;
    expect((await h.store.getRun(run.id))!.currentNodeId).toBe("email");
  });
});
