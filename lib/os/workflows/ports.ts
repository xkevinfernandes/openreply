// The engine's ports on the real world: Postgres contacts and fields, Zernio
// (or Meta) sends, the send cap, J's queue, the Haiku classifier, Kevin's
// to-dos and the timer jobs. Loaded on the server only.

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getUserFollowStatus, sendCommentReply, sendDirectMessage, sendPrivateReply, type InstagramContext } from "@/lib/instagram/provider";
import { stampSend } from "@/lib/os/send-stamp";
import { createInstagramContext } from "@/lib/instagram/context";
import { matchKeywords } from "@/lib/utils/keyword-matcher";
import { zernioRequest } from "@/lib/zernio/client";
import { upsertContact } from "@/lib/os/contacts";
import { addTag, markStopped, removeTag, writeField } from "@/lib/os/fields/write";
import { FOLLOW_UP_FRIDAY } from "@/lib/os/broadcasts/types";
import { capState, checkSend, recordSend } from "@/lib/os/sending/cap";
import { getSetterConfig } from "@/lib/os/setter/config";
import { draft as runDrafter } from "@/lib/os/setter/drafter";
import { sendMessageWithQuickReplies } from "@/lib/meta/client";
import { CLASSIFY_SYSTEM, heuristicClassify, PICK_OPTION_SYSTEM, pickOptionPrompt, readClassification, readPickedOption } from "@/lib/os/workflows/setter-step";
import type { CanSend, ContactInfo, JRequest, OutMessage, Ports, SendContext } from "@/lib/os/workflows/types";
import { sendNoted, textHash } from "@/lib/os/workflows/outbound";

export { textHash };

async function accountContext(instagramAccountId: string, operationId?: string): Promise<{ ctx: InstagramContext; instagramId: string }> {
  const account = await prisma.instagramAccount.findUnique({ where: { id: instagramAccountId } });
  if (!account) throw new Error("Instagram account not connected.");
  return { ctx: await createInstagramContext(account, operationId), instagramId: account.instagramId };
}

/** Text of a bubble for Meta (no multi-button support there): buttons become their text. */
function plain(msg: OutMessage): string {
  if ("url" in msg) return msg.url;
  if ("image" in msg) return msg.image;
  return msg.text;
}

/** Zernio takes up to 3 postback buttons, or up to 13 quick replies, on a DM or a private reply. */
async function zernioSend(ctx: Extract<InstagramContext, { provider: "ZERNIO" }>, target: { commentId?: string; postId?: string | null; recipientId?: string }, msg: OutMessage, key: string) {
  const path = target.commentId
    ? `/inbox/comments/${encodeURIComponent(target.postId ?? target.commentId)}/${encodeURIComponent(target.commentId)}/private-reply`
    : `/inbox/conversations/${encodeURIComponent(target.recipientId!)}/messages`;
  const buttons = "text" in msg && msg.buttons?.length ? msg.buttons.slice(0, 3).map((b) => ({ type: "postback", title: b.label.slice(0, 20), payload: b.payload })) : undefined;
  const quickReplies = !buttons && "text" in msg && msg.quickReplies?.length ? msg.quickReplies.slice(0, 13).map((b) => ({ title: b.label.slice(0, 20), payload: b.payload })) : undefined;
  const body = {
    accountId: ctx.accountId,
    ...("image" in msg ? { attachments: [{ type: "image", url: msg.image }], message: "" } : { message: buttons ? plain(msg).slice(0, 640) : plain(msg) }),
    ...(buttons ? { buttons } : {}),
    ...(quickReplies ? { quickReplies } : {}),
  };
  await zernioRequest({ apiKey: ctx.apiKey, path, method: "POST", body, ...(target.commentId ? {} : { idempotencyKey: createHash("sha256").update(key).digest("hex") }) });
}

const metaReplies = (list: { label: string; payload: string }[]) => list.slice(0, 13).map((b) => ({ title: b.label, payload: b.payload }));

/** Send with the outbound note written first (its echo can beat the send's response). */
const noted = (sc: SendContext, msg: OutMessage, send: () => Promise<unknown>) => sendNoted(sc.workspaceId, sc.igUserId, plain(msg), send);

async function toContactInfo(c: {
  id: string;
  workspaceId: string;
  instagramAccountId: string;
  igUserId: string;
  kind: ContactInfo["kind"];
  paused: boolean;
  tags: string[];
  username: string | null;
  fullName: string | null;
  stage: string;
  setterStage: string | null;
  zernioConversationId: string | null;
}): Promise<ContactInfo> {
  const st = await prisma.setterState.findUnique({ where: { contactId: c.id }, select: { record: true } });
  const last = (st?.record as { their_last_at?: string | null } | null)?.their_last_at ?? null;
  return {
    id: c.id,
    workspaceId: c.workspaceId,
    instagramAccountId: c.instagramAccountId,
    igUserId: c.igUserId,
    kind: c.kind,
    paused: c.paused,
    tags: c.tags,
    username: c.username,
    fullName: c.fullName,
    stage: c.stage,
    setterStage: c.setterStage,
    theirLastAt: last ? new Date(last) : null,
    conversationId: c.zernioConversationId,
  };
}

export function dbPorts(): Ports {
  return {
    now: () => new Date(),
    random: () => Math.random(),

    async contact(workspaceId, instagramAccountId, igUserId, create) {
      let c = await prisma.contact.findUnique({ where: { workspaceId_instagramAccountId_igUserId: { workspaceId, instagramAccountId, igUserId } } });
      if (!c && create) {
        await upsertContact({ workspaceId, instagramAccountId, igUserId, username: create.username ?? null, entryPath: create.entryPath ?? null });
        c = await prisma.contact.findUnique({ where: { workspaceId_instagramAccountId_igUserId: { workspaceId, instagramAccountId, igUserId } } });
      }
      if (!c) return null;
      // A workflow keyword is our own funnel: an unsorted thread becomes Sales (Kevin's own choice stays).
      if (create?.entryPath && c.kind === "UNSORTED" && c.kindSource !== "user") {
        c = await prisma.contact.update({ where: { id: c.id }, data: { kind: "SALES", kindSource: "entry", entryPath: c.entryPath ?? create.entryPath } });
      }
      return toContactInfo(c);
    },
    async setPaused(contactId, paused) {
      await prisma.contact.update({ where: { id: contactId }, data: { paused } }).catch(() => {});
    },
    async writeField(workspaceId, contactId, key, value, ref) {
      const r = await writeField({ workspaceId, contactId, key, value, source: key === "first_name" ? "system" : "step", ref });
      return "applied" in r && r.applied;
    },
    async hasField(contactId, key) {
      if (key === "email") {
        const c = await prisma.contact.findUnique({ where: { id: contactId }, select: { email: true } });
        if (c?.email) return true;
      }
      return (await prisma.contactFieldValue.count({ where: { contactId, field: { key }, value: { not: "" } } })) > 0;
    },
    async addTag(workspaceId, contactId, tag) {
      await addTag({ workspaceId, contactId, tag, source: "step" });
    },
    async removeTag(workspaceId, contactId, tag) {
      await removeTag({ workspaceId, contactId, tag, source: "step" });
    },
    async markStopped(workspaceId, contactId) {
      await markStopped(workspaceId, contactId);
    },
    async friday(workspaceId, contactId) {
      await addTag({ workspaceId, contactId, tag: FOLLOW_UP_FRIDAY.tag, source: "step" });
      await prisma.contact.updateMany({ where: { id: contactId, workspaceId, onFriday: false }, data: { onFriday: true, fridayAddedAt: new Date() } });
    },

    async publicReply(sc, commentId, postId, text) {
      const { ctx } = await accountContext(sc.instagramAccountId);
      await sendCommentReply({ context: ctx, commentId, message: text, postId: postId ?? undefined });
    },
    async privateReply(sc, commentId, postId, msg) {
      const { ctx, instagramId } = await accountContext(sc.instagramAccountId, `wf:${commentId}`);
      await noted(sc, msg, async () => {
        if (ctx.provider === "ZERNIO") await zernioSend(ctx, { commentId, postId }, msg, `pr:${commentId}`);
        else if ("text" in msg && msg.quickReplies?.length) await sendMessageWithQuickReplies(ctx.accessToken, instagramId, { comment_id: commentId }, msg.text, metaReplies(msg.quickReplies));
        else await sendPrivateReply({ context: ctx, instagramAccountId: instagramId, commentId, message: plain(msg), postId: postId ?? undefined });
      });
      await recordSend(sc.workspaceId, { key: `wf-pr:${commentId}`, source: "workflow" });
      // An automated send: last outbound only, never marks the thread read.
      await stampSend({ workspaceId: sc.workspaceId, instagramAccountId: sc.instagramAccountId, igUserId: sc.igUserId }, { human: false });
    },
    async dm(sc: SendContext, msg, opts) {
      const { ctx, instagramId } = await accountContext(sc.instagramAccountId, `wf:${opts.key}`);
      if (opts.humanAgent) throw new Error("A workflow step never sends under HUMAN_AGENT by itself.");
      await noted(sc, msg, async () => {
        if (ctx.provider === "ZERNIO") await zernioSend(ctx, { recipientId: sc.igUserId }, msg, opts.key);
        else if ("text" in msg && msg.quickReplies?.length) await sendMessageWithQuickReplies(ctx.accessToken, instagramId, { id: sc.igUserId }, msg.text, metaReplies(msg.quickReplies));
        else await sendDirectMessage({ context: ctx, instagramAccountId: instagramId, userId: sc.igUserId, message: plain(msg) });
      });
      await recordSend(sc.workspaceId, { key: `wf:${opts.key}`, source: "workflow" });
      await stampSend({ workspaceId: sc.workspaceId, instagramAccountId: sc.instagramAccountId, igUserId: sc.igUserId }, { human: false });
    },
    async canSend(workspaceId, n): Promise<CanSend> {
      return checkSend(await capState(workspaceId), n, "workflow") === "paused" ? "paused" : "ok";
    },
    async follows(sc) {
      const { ctx } = await accountContext(sc.instagramAccountId);
      return getUserFollowStatus({ context: ctx, recipientId: sc.igUserId });
    },
    async resource(workspaceId, slug) {
      const r = await prisma.resource.findUnique({ where: { workspaceId_slug: { workspaceId, slug } } });
      if (!r) return null;
      const d = (r.data && typeof r.data === "object" ? r.data : {}) as { zernio?: { button_url?: string }; resource_url?: string };
      const url = r.link || d.zernio?.button_url || d.resource_url || "";
      return url ? { slug, title: r.name, url } : null;
    },
    async requestJ(req: JRequest) {
      const { enqueueSetterDraft } = await import("@/lib/os/setter/queue");
      if (req.reason === "inbound") {
        // The same job id as queueSetterForInbound: their burst is one J turn.
        const debounceMs = getSetterConfig().debounce_seconds * 1000;
        const bucket = Math.floor(Date.now() / debounceMs);
        await enqueueSetterDraft({ contactId: req.contactId, reason: "inbound" }, { delayMs: debounceMs, jobId: `inbound_${req.contactId}_${bucket}` });
        return;
      }
      await enqueueSetterDraft({ contactId: req.contactId, reason: "workflow" }, { delayMs: 2_000, jobId: `wf_${req.runId}_${req.reason}_${Math.floor(Date.now() / 10_000)}` });
    },
    async pendingJDraft(contactId) {
      return (await prisma.draft.count({ where: { contactId, status: "PENDING" } })) > 0;
    },
    async classify(text, ctx) {
      const fallback = heuristicClassify(text);
      const cfg = getSetterConfig();
      if (cfg.drafter.backend !== "anthropic_api") return fallback;
      try {
        const prompt = `Resource they're waiting for: ${ctx.held.join(", ") || "none"}\nTheir message:\n"""${text.slice(0, 1500)}"""`;
        const r = await runDrafter({ system: CLASSIFY_SYSTEM, prompt, job: "triage", settings: { ...cfg.drafter, max_tokens: { ...cfg.drafter.max_tokens, triage: 200 } } });
        return readClassification(r.obj, fallback);
      } catch (err) {
        console.error("[OS Workflows] classifier:", err instanceof Error ? err.message : err);
        return fallback;
      }
    },
    async pickOption(text, ctx) {
      // Same model and keys as J's classifier; without the API there's no guess (the step retries).
      const cfg = getSetterConfig();
      if (cfg.drafter.backend !== "anthropic_api") return null;
      try {
        const r = await runDrafter({ system: PICK_OPTION_SYSTEM, prompt: pickOptionPrompt(text, ctx), job: "triage", settings: { ...cfg.drafter, max_tokens: { ...cfg.drafter.max_tokens, triage: 100 } } });
        return readPickedOption(r.obj, ctx.options.map((o) => o.id));
      } catch (err) {
        console.error("[OS Workflows] option picker:", err instanceof Error ? err.message : err);
        return null;
      }
    },
    async todo(workspaceId, contactId, key, title, context) {
      await prisma.osTask.createMany({ data: [{ workspaceId, contactId, kind: "workflow", title, context: context as object, dedupeKey: key }], skipDuplicates: true });
    },
    async schedule(runId, at) {
      const { getSetterQueue, redisConfigured, WORKFLOW_TICK_JOB } = await import("@/lib/os/setter/queue");
      if (!redisConfigured()) return;
      const delay = Math.max(0, at.getTime() - Date.now()) + 1_000;
      await getSetterQueue().add(WORKFLOW_TICK_JOB, { runId }, { delay, jobId: `wf_tick_${runId}_${at.getTime()}` });
    },
    async campaignOwns(workspaceId, instagramAccountId, ev) {
      const autos = await prisma.automation.findMany({
        where: {
          workspaceId,
          instagramAccountId,
          isActive: true,
          ...(ev.surface === "dm" ? { dmTriggerEnabled: true } : { OR: [{ matchAnyPost: true }, ...(ev.postId ? [{ postId: ev.postId }] : [])] }),
        },
        select: { keywords: true, matchAnyWord: true, wholeWordMatch: true },
      });
      return autos.some((a) => a.matchAnyWord || matchKeywords(ev.text, a.keywords, a.wholeWordMatch).matched);
    },
  };
}
