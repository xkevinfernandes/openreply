// DM events → DataOS, the engine half: the trial reel's original post on the
// run, skipped comments and run ends logged, workflow links through the
// tracked redirect.
import { describe, expect, it } from "vitest";
import { skipReason } from "@/lib/os/workflows/engine";
import { templateGraph } from "@/lib/os/workflows/templates";
import type { WorkflowGraph } from "@/lib/os/workflows/graph";
import { ACCT, harness, text, WS } from "./workflow-harness";

const sendLink = () => templateGraph("send_link", { keyword: "VAULT", resource: "script-vault" });
const onPost = (g: WorkflowGraph, postIds: string[]): WorkflowGraph => ({
  ...g,
  nodes: g.nodes.map((n) => (n.type === "trigger" ? { ...n, data: { ...(n.data as object), postIds } } : n)),
});

function comment(h: ReturnType<typeof harness>, who: string, txt: string, over: { postId?: string; originalPostId?: string | null; commentId?: string } = {}) {
  return h.engine().handleComment({
    workspaceId: WS,
    instagramAccountId: ACCT,
    igUserId: who,
    username: who,
    commentId: over.commentId ?? `cm_${who}_${Math.random()}`,
    postId: over.postId ?? "trial1",
    originalPostId: over.originalPostId ?? null,
    text: txt,
  });
}

describe("originalPostId", () => {
  it("a trial reel's original post is kept on the run's trigger", async () => {
    const h = harness();
    h.publish(onPost(sendLink(), ["orig1"]));
    const out = await comment(h, "sam", "VAULT", { postId: "trial1", originalPostId: "orig1" });
    expect(out.status).toBe("started");
    const run = (await h.run("sam"))!;
    expect(run.trigger.postId).toBe("trial1");
    expect(run.trigger.originalPostId).toBe("orig1");
  });
});

describe("skipped", () => {
  it("owned by an OpenReply automation: logged with the reason, no run", async () => {
    const h = harness();
    const wf = h.publish(sendLink());
    h.state.campaignOwns = true;
    await comment(h, "sam", "VAULT", { commentId: "cm1", originalPostId: "orig1" });
    expect(await h.run("sam")).toBeNull();
    expect(h.store.skips).toEqual([
      expect.objectContaining({ workflowId: wf.id, commentId: "cm1", postId: "trial1", originalPostId: "orig1", reason: "owned_by_automation" }),
    ]);
  });

  it("no keyword on a post a workflow is aimed at: logged; on any other post: nothing", async () => {
    const h = harness();
    const wf = h.publish(onPost(sendLink(), ["trial1"]));
    await comment(h, "sam", "love this", { commentId: "cm1", postId: "trial1" });
    await comment(h, "ana", "love this", { commentId: "cm2", postId: "other" });
    expect(h.store.skips.map((s) => [s.commentId, s.workflowId, s.reason])).toEqual([["cm1", wf.id, "no_keyword"]]);
  });

  it("already running (a repeat comment) is logged with the contact; the duplicate webhook is not", async () => {
    const h = harness();
    h.publish(sendLink());
    await comment(h, "sam", "VAULT", { commentId: "cm1" });
    await comment(h, "sam", "VAULT", { commentId: "cm2" });
    await comment(h, "sam", "VAULT", { commentId: "cm2" });
    expect(h.store.skips.map((s) => [s.commentId, s.reason, s.contactId])).toEqual([["cm2", "already_running", "c_sam"]]);
  });

  it("maps every outcome the workflow didn't take", () => {
    expect(skipReason({ status: "started", runId: "r" })).toBeNull();
    expect(skipReason({ status: "simple_send", runId: "r" })).toBeNull();
    expect(skipReason({ status: "skipped", reason: "rate limit" })).toBe("rate_limit");
    expect(skipReason({ status: "skipped", reason: "re-entry not allowed yet" })).toBe("reentry_blocked");
    expect(skipReason({ status: "skipped", reason: "stopped" })).toBe("stopped");
    expect(skipReason({ status: "todo" })).toBe("paused_by_kevin");
  });
});

describe("completed / exited", () => {
  it("a run that reaches End logs end {status: completed}", async () => {
    const h = harness();
    h.publish(sendLink());
    await comment(h, "sam", "VAULT");
    const run = (await h.run("sam"))!;
    await h.tap("sam", `wf:${run.id}:opener:send`);
    expect((await h.run("sam"))!.status).toBe("completed");
    const ends = h.store.events.filter((e) => e.kind === "end");
    expect(ends).toEqual([expect.objectContaining({ runId: run.id, nodeId: "end", data: { status: "completed", exit: "completed" } })]);
  });

  it("no reply for a week (quiet) logs end {status: exited, exit}", async () => {
    const h = harness();
    h.publish(sendLink());
    await comment(h, "sam", "VAULT");
    await h.wait(8 * 24 * 3600_000);
    const run = (await h.run("sam"))!;
    expect(run.status).toBe("exited");
    expect(h.store.events.filter((e) => e.kind === "end").map((e) => e.data)).toEqual([{ status: "exited", exit: run.exit }]);
  });
});

describe("workflow links go through the tracked redirect", () => {
  it("the link bubble sends the tracked URL, tied to workflow, run, step and resource", async () => {
    const h = harness();
    const calls: unknown[] = [];
    h.ports.trackLink = async (l) => {
      calls.push(l);
      return `https://app.test/r/slug_${l.nodeId}`;
    };
    const wf = h.publish(sendLink());
    await comment(h, "sam", "VAULT");
    const run = (await h.run("sam"))!;
    await h.tap("sam", `wf:${run.id}:opener:send`);
    expect(h.sentTo("sam").map((s) => text(s.msg))).toContain("https://app.test/r/slug_link");
    expect(h.sentTo("sam").map((s) => text(s.msg))).not.toContain("https://kevin.link/vault");
    expect(calls).toEqual([{ workspaceId: WS, workflowId: wf.id, runId: run.id, nodeId: "link", igUserId: "sam", resourceSlug: "script-vault", url: "https://kevin.link/vault" }]);
  });

  it("tracking failing never blocks the send: the raw URL goes", async () => {
    const h = harness();
    h.ports.trackLink = async () => {
      throw new Error("db down");
    };
    h.publish(sendLink());
    await comment(h, "sam", "VAULT");
    const run = (await h.run("sam"))!;
    await h.tap("sam", `wf:${run.id}:opener:send`);
    expect(h.sentTo("sam").map((s) => text(s.msg))).toContain("https://kevin.link/vault");
  });
});
