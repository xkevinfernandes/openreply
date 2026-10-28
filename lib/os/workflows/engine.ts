// The workflow engine: starts runs from triggers, executes steps, waits on
// people and timers, and hands the Setter step to J. Every effect goes
// through deps (types.ts), so tests run it with a memory store, a fake clock,
// a fake Zernio and a fake J. Scenario ids (E1…, S1…, J1…, K1…, O1…) refer to
// docs/sp/dms/2026-10-19-workflows-spec.md.
//
// Entry points (all called from hooks.ts, which never throws):
//   handleComment   a comment on a post (E1, E3–E10, E12, E13, O4, O7)
//   handleInbound   a DM or a button tap (E5–E7, E11, S1–S5, J2, J3…)
//   handleOutbound  Kevin replied by hand, in DM OS or the IG app (K1, K4)
//   handleBooked    a call was booked (J7, R1)
//   afterJSent      J's draft went out (releases, exits, stop)
//   tick            a run's timer (waits, R2, nudge, Quiet, retries)
//   pauseRun / resumeRun (K1, K2)

import { emailIn } from "@/lib/os/setter/state";
import { GotoData, MessageData, portsOf, SetterData as SetterDataSchema, STEP_DATA, type Bubble, type GraphNode, type StepData, type WorkflowGraph } from "@/lib/os/workflows/graph";
import {
  directive,
  FREE_WINDOW_MS,
  HUMAN_AGENT_MS,
  newSetterState,
  nextSetterTimer,
  onSignal,
  stillHeld,
  windowOf,
  type SetterData,
} from "@/lib/os/workflows/setter-step";
import { matchTrigger, triggerNode, type Surface } from "@/lib/os/workflows/triggers";
import { isLive, type ContactInfo, type EngineDeps, type OutMessage, type RunRecord, type RunStatus, type SendContext, type TriggerInfo, type VersionDef, type WorkflowDef } from "@/lib/os/workflows/types";

/** One run per person per keyword per 24h (E13). */
export const RATE_LIMIT_MS = 24 * 3600_000;
/** Public replies on repeat comments inside one run (spam guard, E3/E13). */
export const MAX_REPEAT_REPLIES = 2;
/** Send retries before Failed (O6), with these waits. */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000];
/** Pause all: frozen runs look again after this long (K7). */
export const PAUSED_RECHECK_MS = 15 * 60_000;
/** Follow-gate checks before carrying on (S5). */
export const MAX_FOLLOW_CHECKS = 2;
export const FOLLOW_GATE_TEXT = "follow me first so it comes through, then tap below 👇";
/** Quick replies: the one retry after a typed answer that matches no option. */
export const QUICK_REPLY_RETRY = "didn't quite catch that, tap one of these 👇";
const MAX_STEPS_PER_PASS = 40;
/** The per-run lease (store.lockRun): how long one pass may hold it, and how long a tap waits for it. */
export const RUN_LOCK_TTL_MS = 120_000;
export const RUN_LOCK_WAIT_MS = 20_000;
const RUN_LOCK_POLL_MS = 150;
/** A timer that finds its run busy looks again this much later. */
export const RUN_BUSY_RETRY_MS = 5_000;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type InboundResult = { consumed: boolean; runId: string | null; outcome?: Outcome };
type Ev = { kind: "enter" } | { kind: "reply"; text: string; tap: string | null } | { kind: "timer" };
type QuickReplies = Extract<Bubble, { kind: "quick_replies" }>;

type StepOut =
  | { go: string }
  /** pass: what they said isn't the step's answer (a question, free text at buttons): J sees it. */
  | { wait: string; until?: Date | null; pass?: boolean }
  | { end: RunStatus; exit: string }
  | { blocked: string; until: Date }
  | { failed: string };

export type Outcome =
  | { status: "started"; runId: string }
  | { status: "repeat"; runId: string }
  | { status: "held"; runId: string }
  | { status: "queued"; runId: string }
  | { status: "resent"; runId: string }
  | { status: "simple_send"; runId: string }
  | { status: "todo" }
  | { status: "skipped"; reason: string };

// ---------------------------------------------------------------- helpers
const iso = (d: Date) => d.toISOString();

/** A comment trigger's outcome as a skip reason (DataOS `skipped`), or null when the workflow took it. */
export function skipReason(out: Outcome): string | null {
  switch (out.status) {
    case "repeat":
      return "already_running";
    case "resent":
      return "reentry_resent";
    case "todo":
      return "paused_by_kevin";
    case "skipped":
      return (
        {
          stopped: "stopped",
          "rate limit": "rate_limit",
          "re-entry not allowed yet": "reentry_blocked",
          "already in a run": "already_running",
          "no trigger": "no_trigger",
        }[out.reason] ?? out.reason.replace(/\W+/g, "_")
      );
    default:
      return null;
  }
}

function nodeById(graph: WorkflowGraph, id: string | null): GraphNode | null {
  return id ? (graph.nodes.find((n) => n.id === id) ?? null) : null;
}

function edgeTo(graph: WorkflowGraph, from: string, port: string): string | null {
  const to = graph.edges.find((e) => e.from === from && e.fromPort === port)?.to ?? null;
  if (to || port !== "other") return to;
  // Quick replies: an unconnected "other" goes where the first option goes.
  const node = nodeById(graph, from);
  const first = node ? portsOf(node).find((p) => p.startsWith("reply:")) : undefined;
  return first ? (graph.edges.find((e) => e.from === from && e.fromPort === first)?.to ?? null) : null;
}

function data<T extends keyof typeof STEP_DATA>(node: GraphNode, type: T): StepData<T> {
  return STEP_DATA[type].parse(node.data) as StepData<T>;
}

function ctxOf(run: RunRecord, contact: ContactInfo | null): SendContext {
  return { workspaceId: run.workspaceId, instagramAccountId: run.instagramAccountId, igUserId: run.igUserId, conversationId: contact?.conversationId ?? null };
}

function pick<T>(list: T[], random: () => number, avoid?: T | null): T | null {
  if (!list.length) return null;
  const pool = list.length > 1 && avoid != null ? list.filter((x) => x !== avoid) : list;
  return pool[Math.min(pool.length - 1, Math.floor(random() * pool.length))];
}

/** Every resource a graph hands out (Setter lead magnets, link bubbles). */
export function resourcesOfGraph(graph: WorkflowGraph): string[] {
  const out: string[] = [];
  for (const n of graph.nodes) {
    if (n.type === "setter") {
      const r = SetterDataSchema.safeParse(n.data);
      if (r.success) out.push(...r.data.leadMagnet.resources);
    }
    if (n.type === "message") {
      const r = MessageData.safeParse(n.data);
      if (r.success) for (const b of r.data.bubbles) if (b.kind === "link" && b.resourceSlug) out.push(b.resourceSlug);
    }
  }
  return [...new Set(out)];
}

/** K5: a Message step edited only in its words since this run's version. */
export function textOnlyOverlay(oldData: StepData<"message">, newData: StepData<"message">): StepData<"message"> {
  const shape = (b: Bubble) =>
    b.kind === "buttons"
      ? `buttons:${b.buttons.map((x) => x.id).join(",")}`
      : b.kind === "quick_replies"
        ? `replies:${b.options.map((x) => x.id).join(",")}:${b.saveTo ?? ""}`
        : b.kind === "link"
          ? `link:${b.resourceSlug ?? b.url}`
          : b.kind === "image"
            ? `image:${b.assetUrl}`
            : "text";
  if (oldData.bubbles.length !== newData.bubbles.length) return oldData;
  if (oldData.bubbles.some((b, i) => shape(b) !== shape(newData.bubbles[i]))) return oldData;
  return newData;
}

// ---------------------------------------------------------------- the engine
export class WorkflowEngine {
  constructor(private readonly deps: EngineDeps) {}

  private get store() {
    return this.deps.store;
  }
  private get ports() {
    return this.deps.ports;
  }
  private now() {
    return this.ports.now();
  }

  private versions = new Map<string, VersionDef | null>();
  private async version(id: string): Promise<VersionDef | null> {
    if (!this.versions.has(id)) this.versions.set(id, await this.store.version(id));
    return this.versions.get(id) ?? null;
  }

  private async contactOf(run: RunRecord): Promise<ContactInfo | null> {
    return this.ports.contact(run.workspaceId, run.instagramAccountId, run.igUserId);
  }

  /** Their last message as the engine knows it (the window clock). */
  private theirLast(run: RunRecord, contact: ContactInfo | null): Date | null {
    const a = run.state.theirLastAt ? new Date(run.state.theirLastAt) : null;
    const b = contact?.theirLastAt ?? null;
    if (a && b) return a > b ? a : b;
    return a ?? b;
  }

  private async event(run: RunRecord, nodeId: string, kind: Parameters<WorkflowEngine["store"]["event"]>[0]["kind"], port?: string | null, d?: Record<string, unknown>) {
    await this.store.event({ run, nodeId, kind, port: port ?? null, data: d, at: this.now() });
  }

  // -------------------------------------------------------------- triggers
  async handleComment(ev: {
    workspaceId: string;
    instagramAccountId: string;
    igUserId: string;
    username?: string | null;
    commentId: string;
    postId: string;
    originalPostId?: string | null;
    text: string;
  }): Promise<Outcome> {
    if (!(await this.store.claimInbound(`comment:${ev.commentId}`, ev.workspaceId))) return { status: "skipped", reason: "duplicate" };
    const live = await this.store.liveWorkflows(ev.workspaceId, ev.instagramAccountId);
    const postIds = [ev.postId, ...(ev.originalPostId ? [ev.originalPostId] : [])];
    const m = matchTrigger(live, { surface: "comment", text: ev.text, postIds });
    // Skips are logged (DataOS: comments on a reel a workflow did not take). Read-only contact lookup: a skip never creates one.
    const skip = async (workflowId: string, reason: string, contactId?: string | null) =>
      this.store.skipped({
        workspaceId: ev.workspaceId,
        workflowId,
        contactId: contactId !== undefined ? contactId : ((await this.ports.contact(ev.workspaceId, ev.instagramAccountId, ev.igUserId).catch(() => null))?.id ?? null),
        commentId: ev.commentId,
        postId: ev.postId,
        originalPostId: ev.originalPostId ?? null,
        reason,
        at: this.now(),
      });
    if (!m) {
      // Only a workflow aimed at this very post counts the miss ("any post" would log every comment).
      const aimed = live.find(({ version }) => {
        const t = triggerNode(version.graph);
        return t?.data.kind === "comment" && t.data.postIds !== "any" && t.data.postIds.some((p) => postIds.includes(p));
      });
      if (aimed) await skip(aimed.wf.id, "no_keyword");
      return { status: "skipped", reason: "no workflow" };
    }
    if (await this.ports.campaignOwns(ev.workspaceId, ev.instagramAccountId, { surface: "comment", text: ev.text, postId: ev.postId })) {
      await skip(m.wf.id, "owned_by_automation");
      return { status: "skipped", reason: "an OpenReply campaign owns it" };
    }
    const contact = await this.ports.contact(ev.workspaceId, ev.instagramAccountId, ev.igUserId, { username: ev.username, entryPath: "comment" });
    if (!contact) {
      await skip(m.wf.id, "no_contact", null);
      return { status: "skipped", reason: "no contact" };
    }
    const out = await this.onTrigger(m.wf, m.version, m.keyword, contact, {
      kind: "comment",
      keyword: m.keyword,
      commentId: ev.commentId,
      postId: ev.postId,
      originalPostId: ev.originalPostId ?? null,
      text: ev.text,
    });
    const reason = skipReason(out);
    if (reason) await skip(m.wf.id, reason, contact.id);
    return out;
  }

  /**
   * A DM or a tap. Returns consumed = true when J must stay out of it (the
   * run is on a step that isn't the Setter step, or paused): the engine
   * answers it itself.
   */
  async handleInbound(ev: {
    workspaceId: string;
    instagramAccountId: string;
    igUserId: string;
    mid?: string | null;
    text?: string | null;
    tapPayload?: string | null;
    storyReply?: boolean;
  }): Promise<InboundResult> {
    const dupKey = ev.mid ? `msg:${ev.mid}` : null;
    if (dupKey && !(await this.store.claimInbound(dupKey, ev.workspaceId))) {
      const run = await this.store.liveRun(ev.instagramAccountId, ev.igUserId);
      return { consumed: await this.consumes(run), runId: run?.id ?? null };
    }
    const text = (ev.text ?? "").trim();
    const contact = await this.ports.contact(ev.workspaceId, ev.instagramAccountId, ev.igUserId, ev.storyReply ? { entryPath: "story_reply" } : undefined);
    let run = await this.store.liveRun(ev.instagramAccountId, ev.igUserId);
    // Instagram can name the same person differently in comments and in DMs.
    // A tap carries its run ("wf:<run>:<node>:<id>"): re-key that run to the
    // DM-side id so their typed replies find it too.
    if (!run && ev.tapPayload?.startsWith("wf:")) {
      const byTap = await this.store.getRun(ev.tapPayload.split(":")[1] ?? "");
      if (!byTap) console.info(`[OS Workflows] tap names run ${ev.tapPayload.split(":")[1]}: not found`);
      else
        console.info(
          `[OS Workflows] tap names run ${byTap.id}: status=${byTap.status} node=${byTap.currentNodeId} account=${byTap.instagramAccountId}${byTap.instagramAccountId === ev.instagramAccountId ? "" : `≠${ev.instagramAccountId}`} workspace=${byTap.workspaceId === ev.workspaceId ? "same" : "different"} user=${byTap.igUserId} reason=${byTap.failReason ?? "-"}`
        );
      if (byTap && isLive(byTap.status) && byTap.instagramAccountId === ev.instagramAccountId && byTap.workspaceId === ev.workspaceId) {
        console.info(`[OS Workflows] run ${byTap.id} re-keyed ${byTap.igUserId} → ${ev.igUserId} from a tap`);
        byTap.igUserId = ev.igUserId;
        if (contact) byTap.contactId = contact.id;
        await this.store.saveRun(byTap);
        run = byTap;
      }
    }

    // A keyword DM / story reply can start a workflow (E11) or, mid-run, add to it (E5/E7).
    if (text && !ev.tapPayload) {
      const surface: Surface = ev.storyReply ? "story_reply" : "dm";
      const live = await this.store.liveWorkflows(ev.workspaceId, ev.instagramAccountId);
      const m = matchTrigger(live, { surface, text });
      if (m && !run) {
        if (await this.ports.campaignOwns(ev.workspaceId, ev.instagramAccountId, { surface: "dm", text })) return { consumed: false, runId: null };
        const c = contact ?? (await this.ports.contact(ev.workspaceId, ev.instagramAccountId, ev.igUserId, { entryPath: surface === "dm" ? "keyword_dm" : "story_reply" }));
        if (!c) return { consumed: false, runId: null };
        const outcome = await this.onTrigger(m.wf, m.version, m.keyword, c, { kind: surface, keyword: m.keyword, mid: ev.mid ?? null, text });
        run = await this.store.liveRun(ev.instagramAccountId, ev.igUserId);
        return { consumed: await this.consumes(run), runId: run?.id ?? null, outcome };
      }
      if (m && run && contact) {
        const outcome = await this.onTrigger(m.wf, m.version, m.keyword, contact, { kind: surface, keyword: m.keyword, mid: ev.mid ?? null, text });
        // Started = another workflow replaced the run: report the new one.
        if (outcome.status !== "repeat" && outcome.status !== "held" && outcome.status !== "queued") {
          const now = await this.store.liveRun(ev.instagramAccountId, ev.igUserId);
          return { consumed: await this.consumes(now), runId: now?.id ?? ("runId" in outcome ? outcome.runId : null), outcome };
        }
        run = (await this.store.getRun(run.id)) ?? run;
      }
    }
    // A workflow tap whose run is over (replaced, ended): nothing to do, and nothing for J.
    if (!run) return { consumed: Boolean(ev.tapPayload?.startsWith("wf:")), runId: null };
    if (run.status === "paused") return { consumed: true, runId: run.id };
    const runId = run.id;
    // One pass per run at a time: a tap racing the timer must not undo it.
    return this.locked(runId, () => this.inboundStep(runId, ev, text, contact));
  }

  /** handleInbound under the run's lease: the run is read again, fresh. */
  private async inboundStep(runId: string, ev: { tapPayload?: string | null }, text: string, contact: ContactInfo | null): Promise<InboundResult> {
    const run = await this.store.getRun(runId);
    if (!run || !isLive(run.status)) return { consumed: false, runId: null };
    if (run.status === "paused") return { consumed: true, runId };
    const tap = ev.tapPayload ?? null;
    // A tap on an older step or another run (a double tap, an old message's
    // button): nothing to do, and nothing for J either.
    if (tap?.startsWith("wf:")) {
      const [, tapRun, tapNode] = tap.split(":");
      if (tapRun !== run.id || tapNode !== run.currentNodeId) {
        console.info(`[OS Workflows] stale tap on run ${runId}: names ${tapRun}/${tapNode}, run is on ${run.currentNodeId}`);
        return { consumed: true, runId };
      }
    }

    run.state.theirLastAt = iso(this.now());
    run.state.lastFrom = "them";
    // Any reply opens Instagram's window: the private-reply gate is over (E1).
    run.state.gate = false;
    // The flow's own input (a tap, an answer) never reaches J; entering the
    // Setter step asks J itself. A question or free text the step can't use
    // ("passed") does reach J, and the run keeps waiting.
    const before = await this.consumes(run);
    const r = await this.advance(run, { kind: "reply", text, tap }, contact);
    if (r === "passed") return { consumed: false, runId };
    const after = await this.store.getRun(run.id);
    return { consumed: before || (await this.consumes(after)), runId };
  }

  /** Run fn holding the run's lease, waiting for it a while. Busy too long: go ahead anyway (a lost tap is worse). */
  private async locked<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + RUN_LOCK_WAIT_MS;
    let token = await this.store.lockRun(runId, RUN_LOCK_TTL_MS);
    while (!token && Date.now() < deadline) {
      await sleep(RUN_LOCK_POLL_MS);
      token = await this.store.lockRun(runId, RUN_LOCK_TTL_MS);
    }
    if (!token) console.warn(`[OS Workflows] run ${runId} stayed busy ${RUN_LOCK_WAIT_MS}ms: going ahead`);
    try {
      return await fn();
    } finally {
      if (token) await this.store.unlockRun(runId, token).catch(() => {});
    }
  }

  /** J may draft for this person unless a live run is on another step (or paused). */
  private async consumes(run: RunRecord | null): Promise<boolean> {
    if (!run || !isLive(run.status)) return false;
    if (run.status === "paused") return true;
    if (run.status !== "active" && run.status !== "waiting") return false;
    const v = await this.version(run.versionId);
    const node = v ? nodeById(v.graph, run.currentNodeId) : null;
    return node?.type !== "setter";
  }

  /** A trigger fired for this person (comment, keyword DM, story reply). */
  private async onTrigger(wf: WorkflowDef, version: VersionDef, keyword: string, contact: ContactInfo, trig: TriggerInfo): Promise<Outcome> {
    const now = this.now();
    const ws = contact.workspaceId;
    if (contact.tags.includes("stopped")) return { status: "skipped", reason: "stopped" }; // J10
    const t = triggerNode(version.graph);
    if (!t) return { status: "skipped", reason: "no trigger" };
    const live = await this.store.liveRun(contact.instagramAccountId, contact.igUserId);

    if (live) {
      // E3: same workflow again while it runs: no second opener.
      if (live.workflowId === wf.id) {
        const v = await this.version(live.versionId);
        const node = v ? nodeById(v.graph, live.currentNodeId) : null;
        const spam = (live.state.repeats ?? 0) >= MAX_REPEAT_REPLIES || contact.kind === "PITCHES";
        if (trig.kind === "comment" && trig.commentId && !spam) {
          const text = pick(t.data.publicReplies, () => this.ports.random(), live.state.lastPublicReply ?? null);
          if (text) {
            await this.ports.publicReply(ctxOf(live, contact), trig.commentId, trig.postId ?? null, text).catch(() => {});
            live.state.lastPublicReply = text;
          }
          live.state.repeats = (live.state.repeats ?? 0) + 1;
        }
        if (node?.type === "setter") {
          const d = data(node, "setter");
          const o = onSignal(live.setter, d, { kind: "repeat_keyword" });
          live.setter = o.state;
          if (o.release) live.setter.directive = directive("release", o.release, stillHeld(live.setter), now);
        }
        await this.store.saveRun(live);
        if (node?.type === "setter" && live.setter.directive && trig.kind === "comment" && live.status !== "paused")
          await this.ports.requestJ({ contactId: contact.id, workspaceId: ws, reason: "timer", runId: live.id });
        return { status: "repeat", runId: live.id };
      }
    }
    // The latest trigger wins: another workflow's keyword replaces the live
    // run (once the checks below let the new one start; a blocked trigger
    // leaves the old run alone).
    const replacing = live && live.workflowId !== wf.id ? live : null;

    // E10: Kevin is talking to them: a to-do instead of automation. A paused
    // run being replaced is the exception: it ends, and the contact unpauses.
    if (contact.paused && replacing?.status !== "paused") {
      const links = await this.links(ws, resourcesOfGraph(version.graph));
      await this.ports.todo(ws, contact.id, `wf-paused:${wf.id}:${trig.commentId ?? trig.mid ?? iso(now)}`, `${trig.kind === "comment" ? "commented" : "sent"} ${keyword.toUpperCase()}: send the guide?`, {
        workflowId: wf.id,
        keyword,
        links: links.map((l) => l.url),
      });
      return { status: "todo" };
    }

    // E13: one run per person per keyword per 24h.
    const recentSame = await this.store.runsOf(contact.instagramAccountId, contact.igUserId, { keyword, since: new Date(now.getTime() - RATE_LIMIT_MS) });
    if (recentSame.length) return { status: "skipped", reason: "rate limit" };

    // E4: re-entry rule per workflow.
    const last = (await this.store.runsOf(contact.instagramAccountId, contact.igUserId, { workflowId: wf.id }))[0] ?? null;
    if (last) {
      const r = t.data.reentry;
      const since = (last.endedAt ?? last.startedAt).getTime();
      const allowed = r.mode === "always" || (r.mode === "after_days" && now.getTime() - since >= r.days * 86_400_000);
      if (!allowed) {
        if (last.setter.released.length && !last.state.resent) {
          const links = await this.links(ws, last.setter.released);
          let sent = false;
          const used = { privateReply: false };
          for (const l of links) sent = (await this.firstSend(last, contact, trig, { url: await this.tracked(last, t.id, l.url, l.slug) }, used)) || sent;
          if (sent) {
            last.state.resent = true;
            await this.store.saveRun(last);
            return { status: "resent", runId: last.id };
          }
        }
        return { status: "skipped", reason: "re-entry not allowed yet" };
      }
    }

    if (replacing) {
      // Ended (and saved) first: that frees the person's liveKey for the new run.
      console.info(`[OS Workflows] run ${replacing.id} replaced by ${wf.id} (${keyword})`);
      if (replacing.status === "paused") {
        if (replacing.contactId) await this.ports.setPaused(replacing.contactId, false);
        contact.paused = false;
      }
      replacing.state.pending = [];
      await this.finish(replacing, "exited", "replaced", replacing.currentNodeId);
    }

    const run = await this.store.createRun({
      workspaceId: ws,
      workflowId: wf.id,
      versionId: version.id,
      instagramAccountId: contact.instagramAccountId,
      igUserId: contact.igUserId,
      contactId: contact.id,
      keyword,
      trigger: trig,
      currentNodeId: t.id,
      startedAt: now,
    });
    if (!run) return { status: "skipped", reason: "already in a run" };
    await this.event(run, t.id, "enter");
    if (trig.kind !== "comment") {
      run.state.theirLastAt = iso(now);
      run.state.lastFrom = "them";
    }
    run.state.gate = trig.kind === "comment";
    // S4: what we know at entry goes to the CRM straight away.
    const first = (contact.fullName ?? "").trim().split(/\s+/)[0];
    if (first) await this.ports.writeField(ws, contact.id, "first_name", first, `workflow:${wf.id}:${t.id}`).catch(() => false);
    // Reel tracking: which post and keyword brought them in, on the contact (the run keeps it too).
    if (trig.kind === "comment" && trig.postId) {
      await this.ports.writeField(ws, contact.id, "source_post", trig.postId, `workflow:${wf.id}:${t.id}`).catch(() => false);
      await this.ports.writeField(ws, contact.id, "source_keyword", keyword, `workflow:${wf.id}:${t.id}`).catch(() => false);
    }

    if (trig.kind === "comment" && trig.commentId) {
      const text = pick(t.data.publicReplies, () => this.ports.random());
      if (text) {
        await this.ports.publicReply(ctxOf(run, contact), trig.commentId, trig.postId ?? null, text).catch(() => {});
        run.state.lastPublicReply = text;
      }
    }

    // E9: clients and Personal get a simple send: the link, no questions, no setter.
    if (contact.kind === "PERSONAL" || contact.tags.includes("client")) {
      const links = await this.links(ws, resourcesOfGraph(version.graph));
      const used = { privateReply: false };
      for (const l of links) {
        const ok = await this.firstSend(run, contact, trig, { url: await this.tracked(run, t.id, l.url, l.slug) }, used);
        if (ok) run.setter.released.push(l.slug);
      }
      run.state.privateSent = used.privateReply;
      await this.finish(run, "completed", "simple_send", t.id);
      return { status: "simple_send", runId: run.id };
    }

    await this.event(run, t.id, "leave", "next");
    run.currentNodeId = edgeTo(version.graph, t.id, "next");
    run.state.entered = null;
    await this.advance(run, { kind: "enter" }, contact);
    return { status: "started", runId: run.id };
  }

  private async links(workspaceId: string, slugs: string[]) {
    const out: { slug: string; url: string }[] = [];
    for (const s of slugs) {
      const r = await this.ports.resource(workspaceId, s);
      if (r?.url) out.push({ slug: s, url: r.url });
    }
    return out;
  }

  /** A link this run sends, through the tracked redirect when the ports have one (a click becomes a link_clicked event). */
  private async tracked(run: RunRecord, nodeId: string, url: string, resourceSlug: string | null): Promise<string> {
    if (!this.ports.trackLink) return url;
    try {
      return await this.ports.trackLink({ workspaceId: run.workspaceId, workflowId: run.workflowId, runId: run.id, nodeId, igUserId: run.igUserId, resourceSlug, url });
    } catch {
      return url;
    }
  }

  /** A send outside the step flow (re-entry resend, simple send): the comment's private reply if unused, else a DM. */
  private async firstSend(run: RunRecord, contact: ContactInfo, trig: TriggerInfo, msg: OutMessage, used: { privateReply: boolean }): Promise<boolean> {
    try {
      // This comment's own private reply (one per comment).
      if (trig.kind === "comment" && trig.commentId && !used.privateReply) {
        await this.ports.privateReply(ctxOf(run, contact), trig.commentId, trig.postId ?? null, msg);
        used.privateReply = true;
        return true;
      }
      if (windowOf(this.theirLast(run, contact), this.now()) !== "free") return false;
      if ((await this.ports.canSend(run.workspaceId, 1)) !== "ok") return false;
      await this.ports.dm(ctxOf(run, contact), msg, { humanAgent: false, key: `${run.id}:extra:${this.now().getTime()}` });
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------- the loop
  /** Run steps from the current node until the run waits or ends. */
  async advance(run: RunRecord, first: Ev, contactIn?: ContactInfo | null): Promise<"passed" | void> {
    const version = await this.version(run.versionId);
    if (!version) return this.fail(run, "The workflow version is gone.");
    const contact = contactIn ?? (await this.contactOf(run));
    let ev: Ev = first;
    for (let i = 0; i < MAX_STEPS_PER_PASS; i++) {
      const node = nodeById(version.graph, run.currentNodeId);
      if (!node) return this.finish(run, "completed", "completed", run.currentNodeId);
      if (run.state.entered !== node.id) {
        run.state = { ...run.state, entered: node.id, bubble: 0, askRetried: false, followChecks: 0, blocked: null, blockedTodo: false };
        run.attempts = 0;
        await this.event(run, node.id, "enter");
        if (ev.kind !== "reply") ev = { kind: "enter" };
      }
      run.status = "active";
      let out: StepOut;
      try {
        out = await this.step(run, node, ev, contact, version);
      } catch (err) {
        out = { failed: err instanceof Error ? err.message : String(err) };
      }
      if ("go" in out) {
        await this.event(run, node.id, "leave", out.go);
        const wf = await this.store.workflow(run.workflowId);
        // K6: a workflow switched off ends its runs at their next Setter exit.
        if (out.go.startsWith("exit:") && wf && !wf.active) return this.finish(run, "exited", out.go.slice(5), node.id);
        const to = edgeTo(version.graph, node.id, out.go);
        if (!to) return out.go.startsWith("exit:") ? this.finish(run, "exited", out.go.slice(5), node.id) : this.finish(run, "completed", "completed", node.id);
        run.currentNodeId = to;
        run.state.entered = null;
        // The next step is entered fresh; J reads what they typed from the thread (S1).
        ev = { kind: "enter" };
        continue;
      }
      if ("wait" in out) {
        run.status = "waiting";
        run.waitingFor = out.wait;
        run.waitUntil = out.until ?? null;
        await this.store.saveRun(run);
        if (run.waitUntil) await this.ports.schedule(run.id, run.waitUntil);
        return out.pass ? "passed" : undefined;
      }
      if ("blocked" in out) {
        run.status = "waiting";
        run.waitingFor = "send";
        run.state.blocked = out.blocked;
        run.waitUntil = out.until;
        await this.store.saveRun(run);
        await this.ports.schedule(run.id, out.until);
        return;
      }
      if ("failed" in out) return this.fail(run, out.failed, node.id);
      return this.finish(run, out.end, out.exit, node.id);
    }
    return this.fail(run, "The workflow loops without waiting.");
  }

  private async fail(run: RunRecord, reason: string, nodeId?: string | null) {
    if (nodeId) await this.event(run, nodeId, "failed", null, { reason });
    run.status = "failed";
    run.failReason = reason.slice(0, 500);
    run.waitUntil = null;
    run.endedAt = this.now();
    await this.store.saveRun(run);
  }

  /** End the run; a workflow that waited its turn (E6) starts now. */
  private async finish(run: RunRecord, status: RunStatus, exit: string, nodeId: string | null) {
    run.status = status;
    run.exit = exit;
    run.waitUntil = null;
    run.waitingFor = null;
    run.endedAt = this.now();
    await this.store.saveRun(run);
    await this.event(run, nodeId ?? run.currentNodeId ?? "end", "end", null, { status, exit });
    const pending = run.state.pending ?? [];
    if (pending.length && status !== "replaced" && status !== "failed" && exit !== "stopped") {
      const p = pending[0];
      const wf = await this.store.workflow(p.workflowId);
      const v = wf?.active && wf.currentVersionId ? await this.version(wf.currentVersionId) : null;
      const contact = await this.contactOf(run);
      if (wf && v && contact) {
        const next = await this.onTrigger(wf, v, p.keyword ?? "", contact, p.trigger);
        if (next.status === "started" && pending.length > 1) {
          const nr = await this.store.liveRun(run.instagramAccountId, run.igUserId);
          if (nr) {
            nr.state.pending = pending.slice(1);
            await this.store.saveRun(nr);
          }
        }
      }
    }
  }

  // -------------------------------------------------------------- sending
  /**
   * One bubble from a step. The comment's first private reply is the opener
   * (never capped: speed to lead, K8); after that nothing goes until they
   * reply (E1). Then the window, Pause all and the cap decide (K7, K8).
   */
  private async send(run: RunRecord, contact: ContactInfo | null, msg: OutMessage, nodeId: string): Promise<"sent" | "gate" | StepOut> {
    const now = this.now();
    if (contact?.tags.includes("stopped")) return { end: "exited", exit: "stopped" };
    const trig = run.trigger;
    const opener = trig.kind === "comment" && Boolean(trig.commentId) && !run.state.privateSent;
    if (!opener && run.state.gate) return "gate";
    try {
      if (opener) {
        const can = await this.ports.canSend(run.workspaceId, 1);
        if (can === "paused") return { blocked: "Pause all is on", until: new Date(now.getTime() + PAUSED_RECHECK_MS) };
        await this.ports.privateReply(ctxOf(run, contact), trig.commentId!, trig.postId ?? null, msg);
        run.state.privateSent = true;
      } else {
        const last = this.theirLast(run, contact);
        const win = windowOf(last, now);
        if (win === "closed") return { end: "exited", exit: "quiet" };
        if (win === "human_agent") {
          // A template step can't go by itself past 24h: Kevin decides (HUMAN_AGENT is approve-only).
          if (!run.state.blockedTodo && run.contactId) {
            await this.ports.todo(run.workspaceId, run.contactId, `wf-window:${run.id}:${nodeId}`, "Workflow step is past Instagram's 24h: send it yourself?", { runId: run.id, nodeId });
            run.state.blockedTodo = true;
          }
          return { wait: "reply", until: new Date(last!.getTime() + HUMAN_AGENT_MS) };
        }
        // Only Pause all stops a workflow send: the daily limit is J's (lib/os/sending/cap.ts).
        const can = await this.ports.canSend(run.workspaceId, 1);
        if (can === "paused") return { blocked: "Pause all is on", until: new Date(now.getTime() + PAUSED_RECHECK_MS) };
        await this.ports.dm(ctxOf(run, contact), msg, { humanAgent: false, key: `${run.id}:${nodeId}:${run.state.bubble ?? 0}` });
      }
      run.state.lastSentAt = iso(now);
      run.state.lastFrom = "us";
      run.attempts = 0;
      await this.event(run, nodeId, "sent");
      return "sent";
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      run.attempts += 1;
      if (run.attempts > RETRY_DELAYS_MS.length) return { failed: `Send failed ${run.attempts} times: ${reason}` };
      return { blocked: `Send failed, retrying: ${reason}`, until: new Date(now.getTime() + RETRY_DELAYS_MS[run.attempts - 1]) };
    }
  }

  private async toOut(run: RunRecord, node: GraphNode, b: Bubble): Promise<OutMessage | null> {
    switch (b.kind) {
      case "text":
        return { text: b.text };
      case "image":
        return { image: b.assetUrl };
      case "link": {
        if (b.url) return { url: await this.tracked(run, node.id, b.url, b.resourceSlug ?? null) };
        const r = b.resourceSlug ? await this.ports.resource(run.workspaceId, b.resourceSlug) : null;
        return r?.url ? { url: await this.tracked(run, node.id, r.url, r.slug) } : null;
      }
      case "buttons":
        return { text: b.text, buttons: b.buttons.map((x) => ({ id: x.id, label: x.label, payload: `wf:${run.id}:${node.id}:${x.id}` })) };
      case "quick_replies":
        return { text: b.text, quickReplies: this.chips(run, node, b) };
    }
  }

  /** Quick-reply chips carry the same payload as a button: the webhook routes both the same way. */
  private chips(run: RunRecord, node: GraphNode, b: QuickReplies) {
    return b.options.map((x) => ({ id: x.id, label: x.label, payload: `wf:${run.id}:${node.id}:${x.id}` }));
  }

  // -------------------------------------------------------------- steps
  private async step(run: RunRecord, node: GraphNode, ev: Ev, contact: ContactInfo | null, version: VersionDef): Promise<StepOut> {
    switch (node.type) {
      case "trigger":
        return { go: "next" };
      case "message":
        return this.message(run, node, ev, contact);
      case "wait":
        return this.wait(run, node, ev, contact);
      case "ask":
        return this.ask(run, node, ev, contact, version);
      case "condition":
        return this.condition(run, node, ev, contact);
      case "action":
        return this.action(run, node, contact);
      case "randomizer": {
        const d = data(node, "randomizer");
        const branch = await this.store.assignment(
          { workspaceId: run.workspaceId, workflowId: run.workflowId, nodeId: node.id, instagramAccountId: run.instagramAccountId, igUserId: run.igUserId },
          () => {
            const total = d.branches.reduce((n, b) => n + b.weight, 0);
            let r = this.ports.random() * total;
            for (const b of d.branches) {
              r -= b.weight;
              if (r < 0) return b.id;
            }
            return d.branches[d.branches.length - 1].id;
          }
        );
        return { go: `branch:${d.branches.some((b) => b.id === branch) ? branch : d.branches[0].id}` };
      }
      case "setter":
        return this.setter(run, node, ev, contact);
      case "goto":
        return this.goto(run, node, contact);
      case "end":
        return { end: "completed", exit: "completed" };
    }
  }

  /** The message as it should go now (K5: text-only edits of unreached steps apply). */
  private async messageData(run: RunRecord, node: GraphNode): Promise<StepData<"message">> {
    const mine = data(node, "message");
    const wf = await this.store.workflow(run.workflowId);
    if (!wf?.currentVersionId || wf.currentVersionId === run.versionId) return mine;
    const cur = await this.version(wf.currentVersionId);
    const other = cur ? nodeById(cur.graph, node.id) : null;
    if (!other || other.type !== "message") return mine;
    const parsed = MessageData.safeParse(other.data);
    return parsed.success ? textOnlyOverlay(mine, parsed.data) : mine;
  }

  private async message(run: RunRecord, node: GraphNode, ev: Ev, contact: ContactInfo | null): Promise<StepOut> {
    const d = await this.messageData(run, node);
    const buttons = d.bubbles.flatMap((b) => (b.kind === "buttons" ? b.buttons : []));
    const replies = d.bubbles.find((b): b is QuickReplies => b.kind === "quick_replies") ?? null;
    const allSent = (run.state.bubble ?? 0) >= d.bubbles.length;
    // No answer (to the buttons, the quick replies or their retry): the run ends Quiet.
    if (ev.kind === "timer" && run.waitingFor === "reply" && run.waitUntil && this.now() >= run.waitUntil) return { end: "exited", exit: "quiet" };
    if (ev.kind === "reply" && allSent && replies) return this.quickReply(run, node, replies, ev, contact);
    if (ev.kind === "reply" && allSent && buttons.length) {
      // S1: typing a button's label (any case, any spaces) counts as the tap.
      const tapped = ev.tap?.startsWith(`wf:${run.id}:${node.id}:`) ? ev.tap.split(":").pop()! : null;
      const norm = (t: string) => t.toLowerCase().replace(/\s+/g, "");
      const typed = ev.text.trim() ? buttons.find((b) => norm(b.label) === norm(ev.text)) : undefined;
      const id = (tapped && buttons.some((b) => b.id === tapped) ? tapped : null) ?? typed?.id ?? null;
      // Anything else (a question, "wait what is this"): the buttons keep waiting and J answers it.
      if (!id) return { wait: "reply", until: this.replyDeadline(run, contact), pass: true };
      await this.event(run, node.id, "replied");
      return { go: `button:${id}` };
    }
    if (ev.kind === "reply") await this.event(run, node.id, "replied");
    for (let i = run.state.bubble ?? 0; i < d.bubbles.length; i++) {
      const msg = await this.toOut(run, node, d.bubbles[i]);
      if (msg) {
        const r = await this.send(run, contact, msg, node.id);
        if (r === "gate") return { wait: "reply", until: this.replyDeadline(run, contact) };
        if (r !== "sent") return r;
        const b = d.bubbles[i];
        if (b.kind === "link" && b.resourceSlug && !run.setter.released.includes(b.resourceSlug)) {
          run.setter.released.push(b.resourceSlug);
          await this.event(run, node.id, "released", null, { slug: b.resourceSlug, rule: "message" });
        }
      }
      run.state.bubble = i + 1;
      await this.store.saveRun(run);
    }
    if (buttons.length || replies) return { wait: "reply", until: this.replyDeadline(run, contact) };
    // After the comment's private reply, the next step waits for their answer (E1).
    if (run.state.gate) return { wait: "reply", until: this.replyDeadline(run, contact) };
    return { go: "next" };
  }

  /**
   * An answer to quick replies. A tap, or the label typed (case and spaces
   * don't matter), picks that option. Anything else goes to the model J's
   * classifier uses, which maps it to one option or none. None: one retry
   * with the same chips; a second miss saves what they typed as-is and leaves
   * by "other" (unconnected, "other" follows the first option). A refusal
   * ("skip", "no thanks", a question back) leaves by "other" without saving.
   */
  private async quickReply(run: RunRecord, node: GraphNode, b: QuickReplies, ev: Extract<Ev, { kind: "reply" }>, contact: ContactInfo | null): Promise<StepOut> {
    const prefix = `wf:${run.id}:${node.id}:`;
    const tapped = ev.tap?.startsWith(prefix) ? ev.tap.slice(prefix.length) : null;
    const said = ev.text.trim();
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, "");
    let via: "tap" | "typed" | "model" | null = null;
    let opt = b.options.find((o) => o.id === tapped);
    if (opt) via = "tap";
    else if (said) {
      opt = b.options.find((o) => norm(o.label) === norm(said));
      if (opt) via = "typed";
      else {
        const id = await this.ports.pickOption(said, { question: b.text, options: b.options.map((o) => ({ id: o.id, label: o.label })) }).catch(() => null);
        opt = b.options.find((o) => o.id === id);
        if (opt) via = "model";
      }
    }
    const save = async (value: string) => {
      // S4: synced the moment it's captured.
      if (b.saveTo && run.contactId) await this.ports.writeField(run.workspaceId, run.contactId, b.saveTo, value, `workflow:${run.workflowId}:${node.id}`).catch(() => false);
    };
    if (opt) {
      await this.event(run, node.id, "replied", null, { option: opt.id, via });
      await save(opt.label);
      return { go: `reply:${opt.id}` };
    }
    await this.event(run, node.id, "replied", null, { option: null });
    if (isRefusal(said)) return { go: "other" };
    if (!run.state.askRetried) {
      const r = await this.send(run, contact, { text: QUICK_REPLY_RETRY, quickReplies: this.chips(run, node, b) }, node.id);
      if (r !== "sent" && r !== "gate") return r;
      run.state.askRetried = true;
      return { wait: "reply", until: this.replyDeadline(run, contact) };
    }
    if (said) await save(said);
    return { go: "other" };
  }

  /** Nothing can be sent 7 days after their last message (or the comment): the run ends Quiet (E2). */
  private replyDeadline(run: RunRecord, contact: ContactInfo | null): Date {
    // From whichever is later: their last message, or this run's start (the
    // comment). An old DM from weeks ago must not end a fresh run at once.
    const last = this.theirLast(run, contact);
    const base = last && last > run.startedAt ? last : run.startedAt;
    return new Date(base.getTime() + HUMAN_AGENT_MS);
  }

  private async wait(run: RunRecord, node: GraphNode, ev: Ev, contact: ContactInfo | null): Promise<StepOut> {
    const d = data(node, "wait");
    const now = this.now();
    if (d.mode === "delay") {
      if (ev.kind === "enter") return { wait: "delay", until: new Date(now.getTime() + (d.minutes ?? 1) * 60_000) };
      if (ev.kind === "timer" && run.waitUntil && now >= run.waitUntil) return { go: "next" };
      return { wait: "delay", until: run.waitUntil ?? new Date(now.getTime() + (d.minutes ?? 1) * 60_000) };
    }
    const timeout = d.timeoutMinutes ? new Date(now.getTime() + d.timeoutMinutes * 60_000) : null;
    const deadline = () => (ev.kind === "enter" ? timeout : run.waitUntil) ?? this.replyDeadline(run, contact);
    if (d.mode === "until_field") {
      if (d.fieldKey && run.contactId && (await this.ports.hasField(run.contactId, d.fieldKey))) return { go: "next" };
    } else if (ev.kind === "reply") {
      await this.event(run, node.id, "replied");
      return { go: "next" };
    }
    if (ev.kind === "timer" && run.waitUntil && now >= run.waitUntil) return d.timeoutMinutes ? { go: "timeout" } : { end: "exited", exit: "quiet" };
    return { wait: d.mode === "until_field" ? "field" : "reply", until: deadline() };
  }

  private async ask(run: RunRecord, node: GraphNode, ev: Ev, contact: ContactInfo | null, version: VersionDef): Promise<StepOut> {
    const d = data(node, "ask");
    if (ev.kind === "enter" || (ev.kind === "reply" && (run.state.bubble ?? 0) === 0)) {
      if ((run.state.bubble ?? 0) === 0) {
        const r = await this.send(run, contact, { text: d.question }, node.id);
        if (r === "gate") return { wait: "reply", until: this.replyDeadline(run, contact) };
        if (r !== "sent") return r;
        run.state.bubble = 1;
        await this.store.saveRun(run);
      }
      return { wait: "reply", until: this.replyDeadline(run, contact) };
    }
    if (ev.kind === "timer") {
      if (run.waitUntil && this.now() >= run.waitUntil) return { end: "exited", exit: "quiet" };
      return { wait: "reply", until: run.waitUntil ?? this.replyDeadline(run, contact) };
    }
    // A question back ("what's it for?"): not an answer and not a no. The step keeps waiting; J answers it.
    if (isQuestion(ev.text, d.validate)) return { wait: "reply", until: this.replyDeadline(run, contact), pass: true };
    const value = validateAnswer(d.validate, ev.text);
    // saved: the answer was captured (by-reel stats count emails from it).
    await this.event(run, node.id, "replied", null, value != null ? { saved: true, validate: d.validate } : undefined);
    if (value != null) {
      // S4: synced the moment it's captured.
      if (run.contactId) await this.ports.writeField(run.workspaceId, run.contactId, d.saveTo, value, `workflow:${run.workflowId}:${node.id}`).catch(() => false);
      return { go: "next" };
    }
    // S3: they refuse or ask why: no hostage on the answer (J picks it up if a Setter step is next).
    if (isRefusal(ev.text)) return { go: "next" };
    // S2: one retry, then carry on without it.
    if (!run.state.askRetried && d.retry) {
      const r = await this.send(run, contact, { text: d.retry }, node.id);
      if (r !== "sent" && r !== "gate") return r;
      run.state.askRetried = true;
      return { wait: "reply", until: this.replyDeadline(run, contact) };
    }
    void version;
    return { go: "next" };
  }

  private async condition(run: RunRecord, node: GraphNode, ev: Ev, contact: ContactInfo | null): Promise<StepOut> {
    const d = data(node, "condition");
    const graphHasNo = async () => {
      const v = await this.version(run.versionId);
      return Boolean(v && edgeTo(v.graph, node.id, "no"));
    };
    switch (d.rule.kind) {
      case "follows": {
        if (ev.kind === "timer" && run.waitUntil && this.now() >= run.waitUntil) return { end: "exited", exit: "quiet" };
        const follows = await this.ports.follows(ctxOf(run, contact)).catch(() => null);
        if (follows) return { go: "yes" };
        const checks = run.state.followChecks ?? 0;
        // S5: the follow-gate message, at most 2 checks, then carry on.
        if (follows === null || checks >= MAX_FOLLOW_CHECKS) return { go: (await graphHasNo()) ? "no" : "yes" };
        const r = await this.send(run, contact, { text: FOLLOW_GATE_TEXT, buttons: [{ id: "followed", label: "I followed", payload: `wf:${run.id}:${node.id}:followed` }] }, node.id);
        if (r === "gate") return { wait: "reply", until: this.replyDeadline(run, contact) };
        if (r !== "sent") return r;
        run.state.followChecks = checks + 1;
        return { wait: "reply", until: this.replyDeadline(run, contact) };
      }
      case "tag":
        return { go: contact?.tags.map((t) => t.toLowerCase()).includes((d.rule.value ?? "").toLowerCase()) ? "yes" : "no" };
      case "field_set":
        return { go: run.contactId && d.rule.value && (await this.ports.hasField(run.contactId, d.rule.value)) ? "yes" : "no" };
      case "keyword_seen": {
        const k = (d.rule.value ?? "").trim().toLowerCase();
        const seen = k ? (await this.store.runsOf(run.instagramAccountId, run.igUserId, { keyword: k })).length > 0 : false;
        return { go: seen ? "yes" : "no" };
      }
      case "stage": {
        const v = (d.rule.value ?? "").toLowerCase();
        return { go: v && [contact?.stage, contact?.setterStage].some((s) => (s ?? "").toLowerCase() === v) ? "yes" : "no" };
      }
    }
  }

  private async action(run: RunRecord, node: GraphNode, contact: ContactInfo | null): Promise<StepOut> {
    const d = data(node, "action");
    const cid = run.contactId ?? contact?.id;
    if (!cid) return { go: "next" };
    for (const op of d.ops) {
      if (op.op === "add_tag" && op.key) {
        await this.ports.addTag(run.workspaceId, cid, op.key);
        // A Condition later in this same pass reads the tag it just got.
        if (contact && !contact.tags.includes(op.key)) contact.tags.push(op.key);
      }
      if (op.op === "remove_tag" && op.key) {
        await this.ports.removeTag(run.workspaceId, cid, op.key);
        if (contact) contact.tags = contact.tags.filter((t) => t !== op.key);
      }
      if (op.op === "set_field" && op.key && op.value != null) await this.ports.writeField(run.workspaceId, cid, op.key, op.value, `workflow:${run.workflowId}:${node.id}`);
      if (op.op === "friday") await this.ports.friday(run.workspaceId, cid);
    }
    return { go: "next" };
  }

  /** S8: the run ends as Replaced and the other workflow starts at its first step (no trigger). */
  private async goto(run: RunRecord, node: GraphNode, contact: ContactInfo | null): Promise<StepOut> {
    const d = GotoData.parse(node.data);
    const wf = await this.store.workflow(d.workflowId);
    const v = wf?.currentVersionId ? await this.version(wf.currentVersionId) : null;
    const t = v ? triggerNode(v.graph) : null;
    if (!wf || !v || !t) return { end: "completed", exit: "completed" };
    await this.event(run, node.id, "leave", "goto");
    await this.finish({ ...run, state: { ...run.state, pending: [] } } as RunRecord, "replaced", "replaced", node.id);
    const next = await this.store.createRun({
      workspaceId: run.workspaceId,
      workflowId: wf.id,
      versionId: v.id,
      instagramAccountId: run.instagramAccountId,
      igUserId: run.igUserId,
      contactId: run.contactId,
      keyword: null,
      trigger: { kind: "goto", fromRunId: run.id },
      currentNodeId: edgeTo(v.graph, t.id, "next"),
      startedAt: this.now(),
    });
    if (next) {
      next.state = { theirLastAt: run.state.theirLastAt, gate: run.state.gate, privateSent: run.state.privateSent, pending: run.state.pending };
      next.setter = { ...next.setter, released: [...run.setter.released] };
      await this.advance(next, { kind: "enter" }, contact);
    }
    // The old run is already saved as Replaced: stop this pass.
    return { end: "replaced", exit: "replaced" };
  }

  // -------------------------------------------------------------- the Setter step
  private async setter(run: RunRecord, node: GraphNode, ev: Ev, contact: ContactInfo | null): Promise<StepOut> {
    const d = data(node, "setter");
    const now = this.now();
    if (ev.kind === "enter") {
      // E8: Pitches never reach J. Their run ends after the Message steps.
      if (contact?.kind === "PITCHES") return { end: "completed", exit: "pitches" };
      const released = run.setter.released ?? [];
      run.setter = { ...newSetterState(node.id, d), released: [...released] };
      // E6 → E5: workflows that waited add their resources to the hold list.
      const pending = run.state.pending ?? [];
      for (const p of pending) {
        const wf = await this.store.workflow(p.workflowId);
        const v = wf?.currentVersionId ? await this.version(wf.currentVersionId) : null;
        const extra = v ? resourcesOfGraph(v.graph) : [];
        for (const r of extra) if (!run.setter.held.includes(r) && !released.includes(r)) run.setter.held.push(r);
        run.setter.notes.push(`also asked for ${extra.join(", ") || wf?.name || "another resource"}${p.keyword ? ` (${p.keyword})` : ""}`);
      }
      run.state.pending = [];
      // Send first, then talk: the links go now (Kevin's template, sends by itself).
      if (d.leadMagnet.mode === "send_first") {
        for (const l of await this.links(run.workspaceId, d.leadMagnet.resources.filter((s) => !released.includes(s)))) {
          const r = await this.send(run, contact, { url: await this.tracked(run, node.id, l.url, l.slug) }, node.id);
          if (r === "gate") return { wait: "reply", until: this.replyDeadline(run, contact) };
          if (r !== "sent") return r;
          run.setter.released.push(l.slug);
          await this.event(run, node.id, "released", null, { slug: l.slug, rule: "send_first" });
        }
      }
      await this.store.saveRun(run);
      // They wrote after our last message: J answers now.
      if (run.state.lastFrom === "them" && contact && !run.state.gate) await this.ports.requestJ({ contactId: contact.id, workspaceId: run.workspaceId, reason: "inbound", runId: run.id });
      return this.setterWait(run, d, contact);
    }
    if (ev.kind === "reply") {
      await this.event(run, node.id, "replied");
      if (!ev.text) return this.setterWait(run, d, contact);
      const c = await this.ports.classify(ev.text, { held: stillHeld(run.setter), history: [] });
      const o = onSignal(run.setter, d, { kind: "reply", c });
      run.setter = o.state;
      if (o.exit === "stopped") {
        if (run.contactId) await this.ports.markStopped(run.workspaceId, run.contactId);
        return { go: "exit:stopped" };
      }
      if (o.release) run.setter.directive = directive("release", o.release, stillHeld(run.setter), now);
      if (o.exit === "goal_met") return { go: "exit:goal_met" };
      // A fresh message from them: the quiet timer starts over.
      run.setter.quietAt = null;
      run.setter.quietFrom = null;
      return this.setterWait(run, d, contact);
    }
    // Timer.
    if (run.setter.pendingExit && (!run.setter.directive || now.getTime() - new Date(run.setter.directive.at).getTime() > FREE_WINDOW_MS)) return { go: `exit:${run.setter.pendingExit}` };
    const plan = await this.setterPlan(run, d, contact);
    if (plan.kind === "none") return this.setterWait(run, d, contact);
    if (plan.at > now) return this.setterWait(run, d, contact);
    if (plan.kind === "quiet_exit") return { go: "exit:quiet" };
    if (plan.kind === "quiet_release") {
      run.setter.directive = directive("release", "R2", stillHeld(run.setter), now);
      run.setter.releaseRule = "R2";
    } else {
      run.setter.directive = directive("nudge", null, [d.leadMagnet.second!], now);
      run.setter.nudged = true;
    }
    run.setter.quietAt = null;
    await this.store.saveRun(run);
    if (contact) await this.ports.requestJ({ contactId: contact.id, workspaceId: run.workspaceId, reason: "timer", runId: run.id });
    return this.setterWait(run, d, contact);
  }

  private async setterPlan(run: RunRecord, d: SetterData, contact: ContactInfo | null) {
    const theirLastAt = this.theirLast(run, contact);
    const weWroteLast = run.state.lastFrom === "us";
    const pendingDraft = contact ? await this.ports.pendingJDraft(contact.id) : false;
    const plan = nextSetterTimer(run.setter, d, { theirLastAt, weWroteLast, now: this.now(), pendingDraft }, () => this.ports.random());
    if ((plan.kind === "quiet_release" || plan.kind === "nudge") && theirLastAt) {
      run.setter.quietAt = iso(plan.at);
      run.setter.quietFrom = iso(theirLastAt);
    }
    return plan;
  }

  private async setterWait(run: RunRecord, d: SetterData, contact: ContactInfo | null): Promise<StepOut> {
    const plan = await this.setterPlan(run, d, contact);
    // Never replied (a comment run that skipped straight here): Quiet after 7 days.
    const until = plan.kind === "none" ? this.replyDeadline(run, contact) : plan.at;
    return { wait: "setter", until };
  }

  // -------------------------------------------------------------- outside events
  /** J's draft went out (approved or auto-sent). Bubbles as sent; raw = J's output. */
  async afterJSent(contactId: string, info: { bubbles: string[]; exit?: string | null; resourceUrls?: Record<string, string> }): Promise<void> {
    const run = await this.store.liveRunForContact(contactId);
    if (run) await this.locked(run.id, () => this.afterJSentLocked(contactId, info));
  }

  private async afterJSentLocked(contactId: string, info: { bubbles: string[]; exit?: string | null; resourceUrls?: Record<string, string> }): Promise<void> {
    const run = await this.store.liveRunForContact(contactId);
    if (!run || run.status === "paused") return;
    const v = await this.version(run.versionId);
    const node = v ? nodeById(v.graph, run.currentNodeId) : null;
    if (!node || node.type !== "setter") return;
    const d = data(node, "setter");
    const now = this.now();
    run.state.lastSentAt = iso(now);
    run.state.lastFrom = "us";
    const text = info.bubbles.join("\n").toLowerCase();
    const urls = info.resourceUrls ?? Object.fromEntries((await this.links(run.workspaceId, run.setter.held)).map((l) => [l.slug, l.url]));
    for (const [slug, url] of Object.entries(urls)) {
      if (url && text.includes(url.toLowerCase()) && !run.setter.released.includes(slug)) {
        run.setter.released.push(slug);
        await this.event(run, node.id, "released", null, { slug, rule: run.setter.directive?.rule ?? null });
      }
    }
    const dir = run.setter.directive;
    if (dir && (dir.kind === "nudge" || dir.slugs.every((s) => run.setter.released.includes(s)))) run.setter.directive = null;
    const exit = info.exit ?? null;
    if (exit === "stopped") {
      if (run.contactId) await this.ports.markStopped(run.workspaceId, run.contactId);
      return this.advanceWith(run, "exit:stopped");
    }
    if (exit === "goal_met") return this.advanceWith(run, "exit:goal_met");
    if (exit === "not_a_fit") {
      const o = onSignal(run.setter, d, { kind: "not_fit" });
      run.setter = o.state;
      if (o.release) {
        // R5: the resource goes first (warm close), then the step leaves.
        run.setter.directive = directive("release", "R5", stillHeld(run.setter), now);
        run.setter.pendingExit = "not_a_fit";
        await this.store.saveRun(run);
        if (run.contactId) await this.ports.requestJ({ contactId: run.contactId, workspaceId: run.workspaceId, reason: "timer", runId: run.id });
        return void (await this.advance(run, { kind: "timer" }));
      }
      return this.advanceWith(run, "exit:not_a_fit");
    }
    if (run.setter.pendingExit && !run.setter.directive) return this.advanceWith(run, `exit:${run.setter.pendingExit}`);
    await this.store.saveRun(run);
    // We wrote last now: plan the quiet timer.
    await this.advance(run, { kind: "timer" });
  }

  /** Leave the current node by a port and keep going. */
  private async advanceWith(run: RunRecord, port: string): Promise<void> {
    const v = await this.version(run.versionId);
    const node = v ? nodeById(v.graph, run.currentNodeId) : null;
    if (!v || !node) return;
    await this.event(run, node.id, "leave", port);
    const wf = await this.store.workflow(run.workflowId);
    const to = edgeTo(v.graph, node.id, port);
    if (!to || (port.startsWith("exit:") && wf && !wf.active)) return this.finish(run, port.startsWith("exit:") ? "exited" : "completed", port.startsWith("exit:") ? port.slice(5) : "completed", node.id);
    run.currentNodeId = to;
    run.state.entered = null;
    await this.advance(run, { kind: "enter" });
  }

  /** A call was booked (in the DM or on the calendar): R1 release, then Booked (J7). */
  async handleBooked(contactId: string): Promise<void> {
    const run = await this.store.liveRunForContact(contactId);
    if (run) await this.locked(run.id, () => this.handleBookedLocked(contactId));
  }

  private async handleBookedLocked(contactId: string): Promise<void> {
    const run = await this.store.liveRunForContact(contactId);
    if (!run) return;
    const v = await this.version(run.versionId);
    const node = v ? nodeById(v.graph, run.currentNodeId) : null;
    if (!node || node.type !== "setter") return;
    // Already booked, waiting for the R1 release to go out.
    if (run.setter.pendingExit === "booked") return;
    const d = data(node, "setter");
    await this.event(run, node.id, "booked");
    const o = onSignal(run.setter, d, { kind: "booked" });
    run.setter = o.state;
    if (o.release && run.status !== "paused") {
      run.setter.directive = directive("release", "R1", stillHeld(run.setter), this.now());
      run.setter.pendingExit = "booked";
      await this.store.saveRun(run);
      if (run.contactId) await this.ports.requestJ({ contactId: run.contactId, workspaceId: run.workspaceId, reason: "timer", runId: run.id });
      return void (await this.advance(run, { kind: "timer" }));
    }
    return this.advanceWith(run, "exit:booked");
  }

  /** Kevin wrote to them by hand (DM OS or the IG app): pause (K1); his link counts as released (K4). */
  async handleOutbound(ev: { workspaceId: string; instagramAccountId: string; igUserId: string; text: string }): Promise<{ paused: boolean }> {
    const run = await this.store.liveRun(ev.instagramAccountId, ev.igUserId);
    if (!run) return { paused: false };
    const urls = await this.links(run.workspaceId, run.setter.held);
    const t = ev.text.toLowerCase();
    for (const l of urls) if (t.includes(l.url.toLowerCase()) && !run.setter.released.includes(l.slug)) run.setter.released.push(l.slug);
    if (run.setter.directive && run.setter.directive.slugs.every((s) => run.setter.released.includes(s))) run.setter.directive = null;
    if (run.status === "paused") {
      await this.store.saveRun(run);
      return { paused: true };
    }
    await this.pauseRun(run, "you replied");
    return { paused: true };
  }

  async pauseRun(run: RunRecord, reason: string): Promise<void> {
    run.state.pausedFrom = run.status === "paused" ? (run.state.pausedFrom ?? "waiting") : run.status;
    run.status = "paused";
    run.pausedAt = this.now();
    run.pausedReason = reason;
    run.waitUntil = null;
    await this.store.saveRun(run);
    if (run.contactId) await this.ports.setPaused(run.contactId, true);
  }

  /** K2: back to the same step, timers from now; J reads what Kevin wrote. */
  async resumeRun(run: RunRecord): Promise<void> {
    if (run.status !== "paused") return;
    run.status = "waiting";
    run.pausedAt = null;
    run.pausedReason = null;
    if (run.contactId) await this.ports.setPaused(run.contactId, false);
    const v = await this.version(run.versionId);
    const node = v ? nodeById(v.graph, run.currentNodeId) : null;
    const now = this.now();
    if (node?.type === "wait" && run.waitingFor === "delay") {
      const d = data(node, "wait");
      run.waitUntil = new Date(now.getTime() + (d.minutes ?? 1) * 60_000);
    } else if (node?.type === "wait" && run.waitingFor !== "send") {
      const d = data(node, "wait");
      run.waitUntil = d.timeoutMinutes ? new Date(now.getTime() + d.timeoutMinutes * 60_000) : this.replyDeadline(run, await this.contactOf(run));
    } else if (node?.type === "setter") {
      // The quiet timer is chosen again from the thread as it is now.
      run.setter.quietAt = null;
      run.setter.quietFrom = null;
      await this.store.saveRun(run);
      if (run.contactId) await this.ports.requestJ({ contactId: run.contactId, workspaceId: run.workspaceId, reason: "resume", runId: run.id });
      return void (await this.advance(run, { kind: "timer" }));
    } else if (run.waitingFor === "send") {
      await this.store.saveRun(run);
      return void (await this.advance(run, { kind: "timer" }));
    } else {
      run.waitUntil = this.replyDeadline(run, await this.contactOf(run));
    }
    await this.store.saveRun(run);
    if (run.waitUntil) await this.ports.schedule(run.id, run.waitUntil);
  }

  /** A run's timer fired (delayed job, or the sweep). A run busy with a tap is looked at again shortly. */
  async tick(runId: string): Promise<void> {
    const token = await this.store.lockRun(runId, RUN_LOCK_TTL_MS);
    if (!token) {
      const run = await this.store.getRun(runId);
      if (run && (run.status === "waiting" || run.status === "active")) await this.ports.schedule(runId, new Date(this.now().getTime() + RUN_BUSY_RETRY_MS));
      return;
    }
    try {
      await this.tickLocked(runId);
    } finally {
      await this.store.unlockRun(runId, token).catch(() => {});
    }
  }

  private async tickLocked(runId: string): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run || (run.status !== "waiting" && run.status !== "active")) return;
    const now = this.now();
    if (run.waitUntil && run.waitUntil.getTime() > now.getTime() + 1000) {
      await this.ports.schedule(run.id, run.waitUntil);
      return;
    }
    // K7: Pause all freezes runs (nothing sends); they go on after.
    if ((await this.ports.canSend(run.workspaceId, 0)) === "paused") {
      const contact = await this.contactOf(run);
      const v = await this.version(run.versionId);
      const node = v ? nodeById(v.graph, run.currentNodeId) : null;
      const closed = windowOf(this.theirLast(run, contact), now) !== "free";
      if (!(node?.type === "setter" && closed)) {
        run.waitUntil = new Date(now.getTime() + PAUSED_RECHECK_MS);
        await this.store.saveRun(run);
        await this.ports.schedule(run.id, run.waitUntil);
        return;
      }
      // The window closed while paused: that one is lost, list it for Kevin.
      if (run.contactId) await this.ports.todo(run.workspaceId, run.contactId, `wf-lost:${run.id}`, "Window closed during Pause all: this one was lost", { runId: run.id });
    }
    await this.advance(run, { kind: "timer" });
  }

  /** Every live run of a workflow ends now ("Stop everyone now", K6). */
  async stopAll(workflowId: string, runs: RunRecord[]): Promise<number> {
    let n = 0;
    for (const r of runs) {
      if (r.workflowId !== workflowId || !["active", "waiting", "paused"].includes(r.status)) continue;
      if (r.status === "paused" && r.contactId) await this.ports.setPaused(r.contactId, false);
      r.state.pending = [];
      await this.finish(r, "exited", "stopped_by_kevin", r.currentNodeId);
      n++;
    }
    return n;
  }

  /** Delete a workflow: everyone in it stops where they are (paused contacts unpause), then it's gone with its runs. */
  async deleteWorkflow(workflowId: string): Promise<number> {
    const stopped = await this.stopAll(workflowId, await this.store.liveRunsOf(workflowId));
    await this.store.deleteWorkflow(workflowId);
    return stopped;
  }
}

// ---------------------------------------------------------------- answers
export function validateAnswer(kind: "email" | "text" | "number", text: string): string | null {
  const t = (text ?? "").trim();
  if (!t) return null;
  if (kind === "email") return emailIn(t);
  if (kind === "number") {
    const m = /-?\d[\d,.]*\s*k?/i.exec(t);
    if (!m) return null;
    const raw = m[0].replace(/,/g, "").trim();
    const n = /k$/i.test(raw) ? parseFloat(raw) * 1000 : parseFloat(raw);
    return Number.isFinite(n) ? String(n) : null;
  }
  return t;
}

const QUESTION_START = /^(what|whats|what's|why|how|who|where|when|which|is|are|do|does|did|can|could|will|would|should|wait|huh)\b/i;

/**
 * A question back at an Ask step ("is this for the newsletter?"), not an
 * answer: it ends with "?" and doesn't hold a valid answer. For a free-text
 * Ask it must also open like a question ("fitness?" is an answer).
 */
export function isQuestion(text: string, validate: "email" | "text" | "number"): boolean {
  const t = (text ?? "").trim();
  if (!t.endsWith("?")) return false;
  if (validate !== "text") return validateAnswer(validate, t) == null;
  return QUESTION_START.test(t);
}

export function isRefusal(text: string): boolean {
  const t = (text ?? "").trim().toLowerCase();
  return /\?$/.test(t) || /\b(no|nah|nope|why|rather not|prefer not|skip|don'?t want|not giving|what for)\b/.test(t);
}

export { portsOf };
