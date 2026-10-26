// Test harness for the workflow engine: a memory store, a fake clock, a fake
// Zernio (every send recorded), a fake J (requests recorded) and fake contacts.
import { WorkflowEngine } from "@/lib/os/workflows/engine";
import type { WorkflowGraph } from "@/lib/os/workflows/graph";
import { memoryWorkflowStore } from "@/lib/os/workflows/memory-store";
import { heuristicClassify } from "@/lib/os/workflows/setter-step";
import { graphKeywords } from "@/lib/os/workflows/triggers";
import type { CanSend, ContactInfo, JRequest, OutMessage, Ports, WorkflowDef } from "@/lib/os/workflows/types";

export const WS = "ws1";
export const ACCT = "acct1";
export const T0 = new Date("2026-10-21T10:00:00Z");

export interface Sent {
  to: string;
  via: "public" | "private" | "dm";
  msg: OutMessage | { text: string };
  at: Date;
}

export function text(m: Sent["msg"]): string {
  return "text" in m ? m.text : "url" in m ? m.url : m.image;
}

export function harness() {
  let now = new Date(T0);
  let rnd = 0.5;
  const store = memoryWorkflowStore();
  const contacts = new Map<string, ContactInfo>();
  const sent: Sent[] = [];
  const j: JRequest[] = [];
  const todos: { contactId: string; key: string; title: string }[] = [];
  const fields = new Map<string, string>();
  const tagLog: string[] = [];
  const scheduled: { runId: string; at: Date }[] = [];
  const pendingDrafts = new Set<string>();
  /** The fake option picker (J's model): typed text → option id or null. Calls are recorded. */
  let picker: (text: string, options: { id: string; label: string }[]) => string | null = () => null;
  const picks: string[] = [];
  const resources: Record<string, string> = { "setter-starter": "https://kevin.link/starter", "script-vault": "https://kevin.link/vault", quiz: "https://kevin.link/quiz" };
  const state = { can: "ok" as CanSend, failNext: 0, follows: false as boolean | null, campaignOwns: false };

  const contactFor = (igUserId: string, create?: { username?: string | null; entryPath?: string | null }): ContactInfo | null => {
    let c = contacts.get(igUserId);
    if (!c && create) {
      c = {
        id: `c_${igUserId}`,
        workspaceId: WS,
        instagramAccountId: ACCT,
        igUserId,
        kind: "SALES",
        paused: false,
        tags: [],
        username: create.username ?? igUserId,
        fullName: null,
        stage: null,
        setterStage: null,
        theirLastAt: null,
        conversationId: `conv_${igUserId}`,
      };
      contacts.set(igUserId, c);
    }
    return c ?? null;
  };
  const byId = (id: string) => [...contacts.values()].find((c) => c.id === id);

  const maybeFail = () => {
    if (state.failNext > 0) {
      state.failNext--;
      throw new Error("Zernio 500");
    }
  };

  const ports: Ports = {
    now: () => new Date(now),
    random: () => rnd,
    async contact(_ws, _a, igUserId, create) {
      return contactFor(igUserId, create) ?? contactFor(igUserId, {});
    },
    async setPaused(contactId, paused) {
      const c = byId(contactId);
      if (c) c.paused = paused;
    },
    async writeField(_ws, contactId, key, value) {
      fields.set(`${contactId}:${key}`, value);
      return true;
    },
    async hasField(contactId, key) {
      return fields.has(`${contactId}:${key}`);
    },
    async addTag(_ws, contactId, tag) {
      const c = byId(contactId);
      if (c && !c.tags.includes(tag)) c.tags.push(tag);
      tagLog.push(`+${tag}`);
    },
    async removeTag(_ws, contactId, tag) {
      const c = byId(contactId);
      if (c) c.tags = c.tags.filter((t) => t !== tag);
      tagLog.push(`-${tag}`);
    },
    async markStopped(_ws, contactId) {
      const c = byId(contactId);
      if (c && !c.tags.includes("stopped")) c.tags.push("stopped");
      tagLog.push("+stopped");
    },
    async friday(_ws, contactId) {
      tagLog.push(`friday:${contactId}`);
    },
    async publicReply(ctx, _commentId, _postId, t) {
      maybeFail();
      sent.push({ to: ctx.igUserId, via: "public", msg: { text: t }, at: new Date(now) });
    },
    async privateReply(ctx, _commentId, _postId, msg) {
      maybeFail();
      sent.push({ to: ctx.igUserId, via: "private", msg, at: new Date(now) });
    },
    async dm(ctx, msg) {
      maybeFail();
      sent.push({ to: ctx.igUserId, via: "dm", msg, at: new Date(now) });
    },
    async canSend() {
      return state.can;
    },
    async follows() {
      return state.follows;
    },
    async resource(_ws, slug) {
      return resources[slug] ? { slug, title: slug, url: resources[slug] } : null;
    },
    async requestJ(req) {
      j.push(req);
    },
    async pendingJDraft(contactId) {
      return pendingDrafts.has(contactId);
    },
    async classify(t) {
      return heuristicClassify(t);
    },
    async pickOption(t, ctx) {
      picks.push(t);
      return picker(t, ctx.options);
    },
    async todo(_ws, contactId, key, title) {
      if (!todos.some((t) => t.key === key)) todos.push({ contactId, key, title });
    },
    async schedule(runId, at) {
      scheduled.push({ runId, at });
    },
    async campaignOwns() {
      return state.campaignOwns;
    },
  };

  const engine = () => new WorkflowEngine({ store, ports });
  let wfSeq = 0;

  const h = {
    store,
    contacts,
    sent,
    j,
    todos,
    fields,
    tagLog,
    scheduled,
    pendingDrafts,
    picks,
    setPicker(fn: typeof picker) {
      picker = fn;
    },
    resources,
    state,
    ports,
    engine,
    get now() {
      return new Date(now);
    },
    setRandom(r: number) {
      rnd = r;
    },
    /** Publish a graph as a new live workflow (or a new version of one). */
    publish(graph: WorkflowGraph, opts: { id?: string; mode?: "draft" | "auto"; active?: boolean } = {}): WorkflowDef {
      const id = opts.id ?? `wf${++wfSeq}`;
      const prev = store.workflows.get(id);
      const number = prev ? [...store.versionsById.values()].filter((v) => v.workflowId === id).length + 1 : 1;
      const vid = `${id}_v${number}`;
      const wf: WorkflowDef = { id, workspaceId: WS, instagramAccountId: null, name: `Workflow ${id}`, mode: opts.mode ?? prev?.mode ?? "draft", active: opts.active ?? true, currentVersionId: vid };
      store.addWorkflow(wf, { id: vid, workflowId: id, number, graph, keywords: graphKeywords(graph) });
      return wf;
    },
    contact(igUserId: string, over: Partial<ContactInfo> = {}): ContactInfo {
      const c = contactFor(igUserId, {})!;
      Object.assign(c, over);
      return c;
    },
    async comment(igUserId: string, txt: string, opts: { commentId?: string; postId?: string } = {}) {
      return engine().handleComment({ workspaceId: WS, instagramAccountId: ACCT, igUserId, username: igUserId, commentId: opts.commentId ?? `cm_${igUserId}_${now.getTime()}_${Math.random()}`, postId: opts.postId ?? "post1", text: txt });
    },
    async dm(igUserId: string, txt: string, opts: { mid?: string; storyReply?: boolean } = {}) {
      const c = contactFor(igUserId, {});
      if (c) c.theirLastAt = new Date(now);
      return engine().handleInbound({ workspaceId: WS, instagramAccountId: ACCT, igUserId, mid: opts.mid ?? `m_${now.getTime()}_${Math.random()}`, text: txt, storyReply: opts.storyReply });
    },
    async tap(igUserId: string, payload: string) {
      const c = contactFor(igUserId, {});
      if (c) c.theirLastAt = new Date(now);
      return engine().handleInbound({ workspaceId: WS, instagramAccountId: ACCT, igUserId, mid: `tap_${now.getTime()}_${Math.random()}`, text: null, tapPayload: payload });
    },
    /** Move the clock and fire every due timer. */
    async wait(ms: number) {
      now = new Date(now.getTime() + ms);
      for (let i = 0; i < 20; i++) {
        const due = await store.dueRuns(now);
        if (!due.length) return;
        for (const r of due) await engine().tick(r.id);
      }
    },
    async run(igUserId: string) {
      return (await store.liveRun(ACCT, igUserId)) ?? (await store.runsOf(ACCT, igUserId))[0] ?? null;
    },
    sentTo(igUserId: string) {
      return sent.filter((s) => s.to === igUserId);
    },
  };
  return h;
}

export type Harness = ReturnType<typeof harness>;
