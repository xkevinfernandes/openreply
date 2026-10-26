// Where the rest of the app reaches the workflow engine. Every function here
// swallows its own errors: a workflow problem never breaks the webhook, J's
// queue or an approval. Call sites:
//   lib/queue/process-webhook.ts   workflowsFromWebhook (comments, story replies, IG app echoes)
//   app/api/zernio/webhook/…       workflowsFromZernio (outgoing = Kevin in the IG app)
//   lib/os/setter/queue.ts         workflowInbound (DMs, taps), processWorkflowTick
//   lib/os/setter/service.ts       workflowStepFor (J's get_step), workflowAfterJSent
//   lib/os/setter/autopilot.ts     workflowModeFor (Draft / Auto)
//   lib/os/sequences/*             inLiveWorkflow (O1)
//   lib/os/broadcasts/store.ts     liveRunContacts (O3)
//   app/(os)/os/inbox/actions.ts   workflowKevinSent (K1)

import { prisma } from "@/lib/db/client";
import { osMockEnabled } from "@/lib/os/mock";
import { dbWorkflowStore } from "@/lib/os/workflows/db-store";
import { WorkflowEngine } from "@/lib/os/workflows/engine";
import { SetterData } from "@/lib/os/workflows/graph";
import { dbPorts, textHash } from "@/lib/os/workflows/ports";
import { releaseRulesView, stillHeld, type WorkflowStepView } from "@/lib/os/workflows/setter-step";

const quiet = async <T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn();
  } catch (err) {
    console.error(`[OS Workflows] ${label}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
};

/** Off under OS_MOCK (sample data) and in unit tests of other modules. */
const enabled = () => !osMockEnabled() && !process.env.VITEST;

export function workflowEngine(): WorkflowEngine {
  return new WorkflowEngine({ store: dbWorkflowStore, ports: dbPorts() });
}

// ---------------------------------------------------------------- webhook
type RawPayload = {
  object?: string;
  entry?: {
    id?: string;
    changes?: { field?: string; value?: { id?: string; comment_id?: string; text?: string; from?: { id?: string; username?: string }; media?: { id?: string; original_media_id?: string }; media_id?: string } }[];
    messaging?: { sender?: { id?: string }; recipient?: { id?: string }; message?: { mid?: string; text?: string; is_echo?: boolean; reply_to?: { story?: unknown } } }[];
  }[];
};

/** Pure: comments, story replies and outgoing echoes in a webhook payload. */
export function readWebhook(payload: unknown) {
  const p = (payload ?? {}) as RawPayload;
  const comments: { instagramId: string; commentId: string; text: string; fromId: string; username: string | null; postId: string; originalPostId: string | null }[] = [];
  const stories: { instagramId: string; fromId: string; mid: string; text: string }[] = [];
  const echoes: { instagramId: string; toId: string; text: string }[] = [];
  if (p.object !== "instagram") return { comments, stories, echoes };
  for (const e of p.entry ?? []) {
    const ig = e.id ?? "";
    for (const c of e.changes ?? []) {
      if (c.field !== "comments") continue;
      const v = c.value ?? {};
      const id = v.id ?? v.comment_id;
      const post = v.media?.id ?? v.media_id;
      const from = v.from?.id;
      if (!ig || !id || !post || !from || from === ig) continue;
      comments.push({ instagramId: ig, commentId: id, text: v.text ?? "", fromId: from, username: v.from?.username ?? null, postId: post, originalPostId: v.media?.original_media_id && v.media.original_media_id !== post ? v.media.original_media_id : null });
    }
    for (const m of e.messaging ?? []) {
      const msg = m.message;
      if (!msg?.mid) continue;
      if (msg.is_echo) {
        const to = m.recipient?.id;
        if (to && to !== ig && msg.text?.trim()) echoes.push({ instagramId: ig, toId: to, text: msg.text.trim() });
        continue;
      }
      const from = m.sender?.id;
      if (msg.reply_to?.story && from && from !== ig && msg.text?.trim()) stories.push({ instagramId: ig, fromId: from, mid: msg.mid, text: msg.text.trim() });
    }
  }
  return { comments, stories, echoes };
}

/** One line in processInstagramWebhook, before OpenReply queues its jobs. */
export async function workflowsFromWebhook(payload: unknown, accounts: Map<string, { id: string; workspaceId: string }>): Promise<void> {
  if (!enabled()) return;
  await quiet("webhook", undefined, async () => {
    const { comments, stories, echoes } = readWebhook(payload);
    if (!comments.length && !stories.length && !echoes.length) return;
    const engine = workflowEngine();
    for (const c of comments) {
      const a = accounts.get(c.instagramId);
      if (!a) continue;
      await quiet("comment", null, () =>
        engine.handleComment({ workspaceId: a.workspaceId, instagramAccountId: a.id, igUserId: c.fromId, username: c.username, commentId: c.commentId, postId: c.postId, originalPostId: c.originalPostId, text: c.text })
      );
    }
    for (const s of stories) {
      const a = accounts.get(s.instagramId);
      if (!a) continue;
      await quiet("story reply", null, () => engine.handleInbound({ workspaceId: a.workspaceId, instagramAccountId: a.id, igUserId: s.fromId, mid: s.mid, text: s.text, storyReply: true }));
    }
    for (const e of echoes) {
      const a = accounts.get(e.instagramId);
      if (a) await workflowOutgoing({ workspaceId: a.workspaceId, instagramAccountId: a.id, igUserId: e.toId, text: e.text });
    }
  });
}

/** Pure: what the workflows need from a raw Zernio event that normalising drops. */
export function readZernio(payload: unknown): { outgoing: { igUserId: string; text: string } | null; story: { igUserId: string; mid: string; text: string } | null } {
  const p = (payload ?? {}) as {
    event?: string;
    message?: { platformMessageId?: string; direction?: string; text?: string | null; sender?: { id?: string }; storyReply?: unknown; replyTo?: { story?: unknown } | null };
    conversation?: { participantId?: string | null };
    metadata?: { storyReply?: unknown };
  };
  const m = p.message;
  const text = m?.text?.trim() ?? "";
  if (!m || !text) return { outgoing: null, story: null };
  if ((p.event === "message.received" || p.event === "message.sent") && m.direction === "outgoing" && p.conversation?.participantId)
    return { outgoing: { igUserId: p.conversation.participantId, text }, story: null };
  const isStory = Boolean(m.storyReply || m.replyTo?.story || p.metadata?.storyReply);
  if (p.event === "message.received" && m.direction === "incoming" && isStory && m.sender?.id && m.platformMessageId)
    return { outgoing: null, story: { igUserId: m.sender.id, mid: m.platformMessageId, text } };
  return { outgoing: null, story: null };
}

/**
 * Zernio's normaliser drops outgoing messages and the story-reply marker:
 * one line in its route hands us the raw event first. Outgoing = Kevin in the
 * IG app (K1); a story reply can start a story workflow (E11). The normalised
 * DM that follows carries the same message id, so it isn't handled twice.
 */
export async function workflowsFromZernio(workspaceId: string, instagramAccountId: string, payload: unknown): Promise<void> {
  if (!enabled()) return;
  await quiet("zernio raw", undefined, async () => {
    const { outgoing, story } = readZernio(payload);
    if (outgoing) await workflowOutgoing({ workspaceId, instagramAccountId, igUserId: outgoing.igUserId, text: outgoing.text });
    if (story) await workflowEngine().handleInbound({ workspaceId, instagramAccountId, igUserId: story.igUserId, mid: story.mid, text: story.text, storyReply: true });
  });
}

/**
 * An outgoing message seen on Instagram. Ours (a workflow step, J, DM OS, an
 * OpenReply campaign a moment ago) is ignored; anything else is Kevin typing
 * in the IG app, which pauses the run (K1).
 */
export async function workflowOutgoing(ev: { workspaceId: string; instagramAccountId: string; igUserId: string; text: string }): Promise<void> {
  const since = new Date(Date.now() - 15 * 60_000);
  const ours = await prisma.workflowOutbound.count({ where: { igUserId: ev.igUserId, hash: textHash(ev.text), at: { gte: since } } });
  if (ours) return;
  const campaign = await prisma.dmLog.count({ where: { instagramAccountId: ev.instagramAccountId, commenterId: ev.igUserId, OR: [{ dmSentAt: { gte: new Date(Date.now() - 3 * 60_000) } }, { updatedAt: { gte: new Date(Date.now() - 3 * 60_000) } }] } }).catch(() => 0);
  if (campaign) return;
  await quiet("outgoing", null, () => workflowEngine().handleOutbound(ev));
}

/** Kevin sent from the DM OS Inbox: pause the run (K1). */
export async function workflowKevinSent(workspaceId: string, contactId: string | null | undefined, text: string): Promise<void> {
  if (!enabled() || !contactId) return;
  await quiet("kevin sent", undefined, async () => {
    const c = await prisma.contact.findFirst({ where: { id: contactId, workspaceId }, select: { instagramAccountId: true, igUserId: true } });
    if (c) await workflowEngine().handleOutbound({ workspaceId, instagramAccountId: c.instagramAccountId, igUserId: c.igUserId, text });
  });
}

/** Remember an OS send, so its echo isn't taken for Kevin typing in the IG app. */
export async function noteOsSend(workspaceId: string, igUserId: string, text: string): Promise<void> {
  if (!enabled()) return;
  await prisma.workflowOutbound.create({ data: { workspaceId, igUserId, hash: textHash(text) } }).catch(() => {});
}

// ---------------------------------------------------------------- J's side
/** A DM or tap: the engine first. consumed = J stays out of it. */
export async function workflowInbound(ev: { workspaceId: string; instagramAccountId: string; igUserId: string; mid?: string | null; text?: string | null; tapPayload?: string | null }): Promise<{ consumed: boolean }> {
  if (!enabled()) return { consumed: false };
  return quiet("inbound", { consumed: false }, async () => {
    const r = await workflowEngine().handleInbound(ev);
    // One line per tap, so a tap that finds no run shows why.
    if (ev.tapPayload) console.info(`[OS Workflows] tap user=${ev.igUserId} payload=${ev.tapPayload.slice(0, 80)} run=${r.runId ?? "none"} consumed=${r.consumed}${r.outcome ? ` outcome=${r.outcome.status}` : ""}`);
    return { consumed: r.consumed };
  });
}

/** The Setter step J is in (get_step), or null outside a workflow. */
export async function workflowStepFor(contactId: string): Promise<WorkflowStepView | null> {
  if (!enabled()) return null;
  return quiet("step view", null, async () => {
    const run = await dbWorkflowStore.liveRunForContact(contactId);
    if (!run || run.status === "paused") return null;
    const [wf, v] = await Promise.all([dbWorkflowStore.workflow(run.workflowId), dbWorkflowStore.version(run.versionId)]);
    const node = v?.graph.nodes.find((n) => n.id === run.currentNodeId);
    if (!wf || !node || node.type !== "setter") return null;
    const d = SetterData.parse(node.data);
    const slugs = [...new Set([...run.setter.held, ...d.leadMagnet.resources, ...(d.leadMagnet.second ? [d.leadMagnet.second] : [])])];
    const rows = slugs.length ? await prisma.resource.findMany({ where: { workspaceId: run.workspaceId, slug: { in: slugs } }, select: { slug: true, name: true, link: true, data: true } }) : [];
    const url = (r: (typeof rows)[number]) => r.link || ((r.data as { zernio?: { button_url?: string } } | null)?.zernio?.button_url ?? "");
    const title = new Map(rows.map((r) => [r.slug, r.name]));
    const dir = run.setter.directive ?? null;
    return {
      workflowId: wf.id,
      workflowName: wf.name,
      runId: run.id,
      nodeId: node.id,
      mode: wf.mode,
      goal: run.setter.goal ?? d.goal,
      leadMagnet: {
        mode: d.leadMagnet.mode,
        resources: [...new Set([...run.setter.held, ...d.leadMagnet.resources])].map((s) => ({ slug: s, title: title.get(s) ?? s, released: run.setter.released.includes(s) })),
      },
      releaseRules: releaseRulesView(d),
      exits: ["not_a_fit", "stopped", "goal_met"],
      directive: dir,
      notes: run.setter.notes,
      directiveLinks: dir ? rows.filter((r) => dir.slugs.includes(r.slug) && url(r)).map((r) => ({ slug: r.slug, url: url(r) })) : [],
      held: stillHeld(run.setter),
      sendable: rows.filter((r) => url(r)).map((r) => ({ slug: r.slug, title: r.name, url: url(r) })),
    };
  });
}

/** Draft / Auto of the workflow J is running in for this contact (null = none). */
export async function workflowModeFor(contactId: string): Promise<"draft" | "auto" | null> {
  if (!enabled()) return null;
  return quiet("mode", null, async () => {
    const run = await dbWorkflowStore.liveRunForContact(contactId);
    if (!run) return null;
    const wf = await dbWorkflowStore.workflow(run.workflowId);
    return wf?.mode ?? null;
  });
}

/** O1: in a live run, the Setter step's own timeout replaces "gone quiet" follow-ups. */
export async function inLiveWorkflow(contactId: string): Promise<boolean> {
  if (!enabled()) return false;
  return quiet("in workflow", false, async () => Boolean(await dbWorkflowStore.liveRunForContact(contactId)));
}

/**
 * After a J draft went out: the setter-side actions (carried into C1) and the
 * engine's bookkeeping. Tags J proposed are added (removals only on purpose),
 * exit_step runs, "stopped" tags them (never an unsubscribe), a booking's
 * email is written with source booking, and held resources in the bubbles
 * count as released.
 */
export async function workflowAfterJSent(info: { workspaceId: string; contactId: string; draftId: string; bubbles: string[]; bookingId?: string | null; bookingEmail?: string | null }): Promise<void> {
  if (!enabled()) return;
  await quiet("after J sent", undefined, async () => {
    const { addTag, removeTag, writeField, markStopped } = await import("@/lib/os/fields/write");
    const d = await prisma.draft.findUnique({ where: { id: info.draftId }, select: { raw: true, proposedTags: true } });
    const raw = (d?.raw && typeof d.raw === "object" ? d.raw : {}) as { remove_tags?: unknown; exit?: { exit?: string } | null; trace?: { dry?: boolean } };
    const proposed = d?.proposedTags && typeof d.proposedTags === "object" ? Object.keys(d.proposedTags as object) : [];
    for (const tag of proposed) await addTag({ workspaceId: info.workspaceId, contactId: info.contactId, tag, source: "j" });
    for (const tag of Array.isArray(raw.remove_tags) ? raw.remove_tags.map(String) : []) await removeTag({ workspaceId: info.workspaceId, contactId: info.contactId, tag, source: "j" });
    const exit = typeof raw.exit?.exit === "string" ? raw.exit.exit : null;
    if (exit === "stopped") await markStopped(info.workspaceId, info.contactId);
    if (info.bookingId && info.bookingEmail) await writeField({ workspaceId: info.workspaceId, contactId: info.contactId, key: "email", value: info.bookingEmail, source: "booking", ref: info.bookingId });
    await workflowEngine().afterJSent(info.contactId, { bubbles: info.bubbles, exit });
    if (info.bookingId) await workflowEngine().handleBooked(info.contactId);
  });
}

/** A call was booked on the calendar (webhook) or in the DM: R1, then Booked (J7). */
export async function workflowBooked(contactId: string): Promise<void> {
  if (!enabled()) return;
  await quiet("booked", undefined, () => workflowEngine().handleBooked(contactId));
}

/** The os-setter job at a run's time. */
export async function processWorkflowTick(runId: string): Promise<void> {
  await workflowEngine().tick(runId);
}

/** Runs whose timer is due (a sweep, if a delayed job was lost). */
export async function sweepDueRuns(now = new Date()): Promise<number> {
  if (!enabled()) return 0;
  const due = await dbWorkflowStore.dueRuns(now, 200);
  const engine = workflowEngine();
  for (const r of due) await quiet("sweep", undefined, () => engine.tick(r.id));
  return due.length;
}

/** O3: contacts with a live run who had a message in the last 48h (Follow-up Friday skips them). */
export async function liveRunContacts(contactIds: string[]): Promise<Set<string>> {
  if (!enabled() || !contactIds.length) return new Set();
  return quiet("live runs", new Set<string>(), async () => {
    const rows = await prisma.workflowRun.findMany({ where: { contactId: { in: contactIds }, status: { in: ["ACTIVE", "WAITING", "PAUSED"] } }, select: { contactId: true } });
    return new Set(rows.map((r) => r.contactId!).filter(Boolean));
  });
}

/** K3: paused threads older than 3 days (Home › Yours to do). */
export async function pausedThreadsCount(workspaceId: string, now = new Date()): Promise<number> {
  if (!enabled()) return 0;
  return quiet("paused count", 0, () => prisma.workflowRun.count({ where: { workspaceId, status: "PAUSED", pausedAt: { lte: new Date(now.getTime() - 3 * 86_400_000) } } }));
}
