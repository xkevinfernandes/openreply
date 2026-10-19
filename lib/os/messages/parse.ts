// Raw Zernio message -> RichMessage (lib/os/messages/types.ts). Pure.
//
// What the spike found (2026-10-19, 100 real threads, fixture in
// __tests__/os/fixtures/zernio-messages.json):
// - text: `message`; links sit inside the text.
// - story reply: `storyReply: {storyId, storyUrl}` (url has asset_id), any direction, text may be empty.
// - template: attachments[type "template"].payload.generic.elements[{title, subtitle?, image_url?, buttons[{type postback|open_url|web_url, title, url|payload}]}].
// - text + buttons: `metadata.metaInteractive.buttons[{type "url", title, url}]` with the text in `message`.
// - reel share: attachments[type "video"] with payload.reel_video_id (+ title = caption, url /reel/…); originalType "ig_reel" when present.
// - post share: attachments[type "share"] with payload.ig_post_media_id (+ title); originalType "ig_post".
// - story share: attachments[type "share"] with payload.story_media_id / story_media_url.
// - image / video / file: attachments[type …].payload.url (lookaside CDN, expires).
// - voice: attachments[type "audio"].payload.url. No duration.
// - postback: id "postback_…", `metadata.postbackTitle/postbackPayload`.
// - reactions: `reactions[{emoji, fromMe, reactedAt}]` on the reacted message.
// - seen: outgoing `readAt` / `deliveryStatus: "read"`.
// - also: sentVia (comment_automation | api | human), metadata.automationId,
//   metadata.quotedMessageId, isDeleted, isEdited, noRenderableContent.

import type { MessageOrigin, MessagePart, MessageReaction, RichMessage, TemplateButton } from "@/lib/os/messages/types";

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export interface ParseContext {
  /** Message ids of approved setter drafts (J marker). */
  setterMessageIds?: ReadonlySet<string>;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").split(/[/?#]/)[0];
  }
}

/** Text -> text and link parts; every URL becomes its own part. */
export function splitLinks(text: string): MessagePart[] {
  const out: MessagePart[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    // Trailing punctuation belongs to the sentence, not the URL.
    const url = m[0].replace(/[.,!?;:)\]]+$/, "");
    const start = m.index ?? 0;
    const before = text.slice(last, start).trim();
    if (before) out.push({ type: "text", text: before });
    out.push({ type: "link", url, domain: domainOf(url), title: null });
    last = start + url.length;
  }
  const rest = text.slice(last).trim();
  if (rest) out.push({ type: "text", text: rest });
  return out;
}

export function assetIdOf(url: string | null): string | null {
  if (!url) return null;
  return /[?&]asset_id=(\d+)/.exec(url)?.[1] ?? null;
}

function button(b: unknown): TemplateButton | null {
  const o = obj(b);
  const title = str(o?.title);
  if (!o || !title) return null;
  const url = str(o.url);
  return { title, url, payload: str(o.payload), kind: url ? "url" : "postback" };
}

function attachmentParts(a: Obj): MessagePart[] {
  const type = str(a.type);
  const payload = obj(a.payload) ?? {};
  const original = str(a.originalType);
  const url = str(payload.url) ?? str(a.url);
  const caption = str(payload.title);

  if (type === "template" || obj(payload.generic)) {
    const elements = arr(obj(payload.generic)?.elements).map(obj).filter((e): e is Obj => !!e);
    if (!elements.length) return [{ type: "unsupported", label: "Sent a card" }];
    return elements.map((e) => ({
      type: "template" as const,
      image: str(e.image_url) ?? str(e.image),
      title: str(e.title),
      subtitle: str(e.subtitle),
      buttons: arr(e.buttons).map(button).filter((b): b is TemplateButton => !!b),
    }));
  }
  if (str(payload.story_media_id) || str(payload.story_media_url)) {
    return [{ type: "share", kind: "story", mediaId: str(payload.story_media_id), url: str(payload.story_media_url), caption }];
  }
  if (original === "ig_reel" || str(payload.reel_video_id) || (url && /instagram\.com\/reels?\//.test(url))) {
    return [{ type: "share", kind: "reel", mediaId: str(payload.reel_video_id), url, caption }];
  }
  if (original === "ig_post" || str(payload.ig_post_media_id) || type === "share") {
    return [{ type: "share", kind: "post", mediaId: str(payload.ig_post_media_id), url, caption }];
  }
  if (type === "audio") return [{ type: "voice", url, durationMs: null }];
  if (type === "image") return [{ type: "image", url }];
  if (type === "video") return [{ type: "video", url }];
  if (type === "file") return [{ type: "file", url }];
  if (type === "fallback" && url) return [{ type: "link", url, domain: domainOf(url), title: caption }];
  return [{ type: "unsupported", label: "Sent an attachment" }];
}

function origin(m: Obj, meta: Obj | null): MessageOrigin {
  const via = str(m.sentVia) ?? str(meta?.sentVia);
  if (!via) return null;
  if (via.includes("automation")) return "automation";
  if (via === "api") return "api";
  if (via === "human") return "human";
  return null;
}

function delivery(v: unknown): RichMessage["deliveryStatus"] {
  return v === "sent" || v === "delivered" || v === "read" ? v : null;
}

export function parseZernioMessage(raw: unknown, ctx: ParseContext = {}): RichMessage {
  const m = obj(raw) ?? {};
  const meta = obj(m.metadata);
  const id = str(m.id) ?? str(m._id) ?? "";
  const direction = m.direction === "outgoing" ? "outgoing" : "incoming";
  const text = (typeof m.message === "string" ? m.message : "").trim();
  const parts: MessagePart[] = [];

  const story = obj(m.storyReply);
  if (story || m.isStoryMention === true) {
    const url = str(story?.storyUrl);
    parts.push({ type: "story_reply", storyId: str(story?.storyId), assetId: assetIdOf(url), url, mention: m.isStoryMention === true });
  }

  const postbackTitle = str(meta?.postbackTitle);
  const interactive = arr(obj(meta?.metaInteractive)?.buttons).map(button).filter((b): b is TemplateButton => !!b);

  if (postbackTitle) {
    parts.push({ type: "postback", title: postbackTitle, payload: str(meta?.postbackPayload) });
  } else if (interactive.length) {
    // A text sent with buttons renders as one card on Instagram.
    parts.push({ type: "template", image: null, title: text || null, subtitle: null, buttons: interactive });
  } else if (text) {
    parts.push(...splitLinks(text));
  }

  for (const a of arr(m.attachments)) {
    const o = obj(a);
    if (o) parts.push(...attachmentParts(o));
  }

  const deleted = m.isDeleted === true;
  if (!parts.length && !deleted) parts.push({ type: "unsupported", label: m.noRenderableContent === true ? "Sent something Instagram can't show here" : "Sent a message" });

  const reactions: MessageReaction[] = arr(m.reactions)
    .map(obj)
    .filter((r): r is Obj => !!r && !!str(r.emoji))
    .map((r) => ({ emoji: str(r.emoji)!, fromMe: r.fromMe === true, at: str(r.reactedAt) }));

  const firstRefresh = arr(m.attachments).map(obj).find((a) => str(a?.refreshUrl));

  return {
    id,
    direction,
    fromMe: direction === "outgoing",
    at: str(m.sentAt) ?? str(m.createdAt) ?? str(m.timestamp),
    parts: deleted ? [] : parts,
    reactions,
    seenAt: direction === "outgoing" ? (str(m.readAt) ?? null) : null,
    deliveryStatus: delivery(m.deliveryStatus),
    origin: origin(m, meta),
    automationId: str(meta?.automationId),
    fromSetter: direction === "outgoing" && !!ctx.setterMessageIds?.has(id),
    quotedMessageId: str(meta?.quotedMessageId),
    deleted,
    edited: m.isEdited === true,
    refreshUrl: str(firstRefresh?.refreshUrl),
  };
}

/** Newest-first or any order in; oldest first out. */
export function parseZernioMessages(raw: unknown[], ctx: ParseContext = {}): RichMessage[] {
  return raw
    .map((m) => parseZernioMessage(m, ctx))
    .filter((m) => m.id)
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
}

/** One short line for a part: thread previews and the degrade text. */
export function partLabel(p: MessagePart): string {
  switch (p.type) {
    case "text":
      return p.text;
    case "link":
      return p.url;
    case "story_reply":
      return p.mention ? "Mentioned you in their story" : "Replied to your story";
    case "template":
      return p.title ?? "Sent a card";
    case "share":
      return p.kind === "reel" ? "Sent a reel" : p.kind === "story" ? "Sent a story" : "Sent a post";
    case "image":
      return "Sent a photo";
    case "video":
      return "Sent a video";
    case "file":
      return "Sent a file";
    case "voice":
      return "Voice note";
    case "reaction":
      return `Reacted ${p.emoji}`;
    case "postback":
      return p.title;
    case "unsupported":
      return p.label;
  }
}

/** The preview line of a message (thread list, palette). */
export function messagePreview(m: RichMessage): string {
  if (m.deleted) return "Unsent a message";
  const text = m.parts.find((p) => p.type === "text") as { text: string } | undefined;
  return text?.text ?? (m.parts[0] ? partLabel(m.parts[0]) : "");
}
