// Which messages carry media worth saving, and how J reads them. Pure.
//
// One MessageMedia row per message (messageId is unique), so a message with
// several parts is enriched by its most useful one: what they said (voice),
// then what they showed (image), then what they pointed at (story, share).

import type { MessagePart, RichMessage } from "@/lib/os/messages/types";
import type { MediaView } from "@/lib/os/media/index";

export type MediaKind = MediaView["kind"];

export interface MediaItem {
  messageId: string;
  direction: "incoming" | "outgoing";
  kind: MediaKind;
  /** CDN url as Zernio gave it (expires within days). */
  sourceUrl: string | null;
  /** Instagram's caption for a shared reel or post. */
  caption: string | null;
  /** Shared reel/post id (Data OS lookup for our own content). */
  mediaId: string | null;
  shareKind: "reel" | "post" | "story" | null;
  /** Story reply: what Data OS needs to find the story. */
  story: { storyId: string | null; assetId: string | null; at: string | null } | null;
  /** Zernio's endpoint for a fresh CDN url. */
  refreshUrl: string | null;
  at: string | null;
}

/** Kinds that cost a model call (transcribe / describe). */
export const MODEL_KINDS: ReadonlySet<MediaKind> = new Set(["voice", "image"]);

const PRIORITY: MessagePart["type"][] = ["voice", "image", "story_reply", "share", "video", "file"];

/** The media item of one message, or null for plain text, links and cards. */
export function detectMedia(m: RichMessage): MediaItem | null {
  if (m.deleted || !m.id) return null;
  for (const type of PRIORITY) {
    const p = m.parts.find((x) => x.type === type);
    if (!p) continue;
    const base: MediaItem = {
      messageId: m.id,
      direction: m.direction,
      kind: type as MediaKind,
      sourceUrl: null,
      caption: null,
      mediaId: null,
      shareKind: null,
      story: null,
      refreshUrl: m.refreshUrl,
      at: m.at,
    };
    switch (p.type) {
      case "voice":
      case "image":
      case "video":
      case "file":
        return { ...base, sourceUrl: p.url };
      case "story_reply":
        return { ...base, sourceUrl: p.url, story: { storyId: p.storyId, assetId: p.assetId, at: m.at } };
      case "share":
        return { ...base, sourceUrl: p.url, caption: p.caption, mediaId: p.mediaId, shareKind: p.kind };
    }
  }
  return null;
}

export function detectAll(msgs: RichMessage[]): MediaItem[] {
  return msgs.map(detectMedia).filter((x): x is MediaItem => !!x);
}

// ---------------------------------------------------------------- J's view

const clip = (s: string, n: number) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const quoted = (s: string | null | undefined, n = 400) => (s && s.trim() ? ` "${clip(s, n).replace(/"/g, "'")}"` : "");

/** One part as J reads it. Media reads as what it says or shows:
 *  [voice note] "…", [photo: …], [shared a reel: "…"], [replying to your story "…"]. */
export function partText(p: MessagePart, media: MediaView | null | undefined, fromMe: boolean): string {
  switch (p.type) {
    case "text":
      return p.text;
    case "link":
      return p.url;
    case "template": {
      const lines = [p.title, p.subtitle].filter((x): x is string => !!x && !!x.trim()).map((x) => x.trim());
      for (const b of p.buttons) lines.push(`[button: ${b.title || "button"} -> ${b.url || b.payload || ""}]`);
      return lines.join("\n");
    }
    case "postback":
      return `[they tapped: ${p.title}]`;
    case "voice": {
      const t = media?.transcript;
      return t ? `[voice note]${quoted(t, 2000)}` : "[voice note]";
    }
    case "image": {
      const d = media?.description;
      return d ? `[photo: ${clip(d, 300)}]` : "[photo]";
    }
    case "video":
      return media?.description ? `[video: ${clip(media.description, 300)}]` : "[video]";
    case "file":
      return "[file]";
    case "share": {
      const whose = media?.story ? (fromMe ? "our" : "your") : "a";
      const caption = media?.caption ?? p.caption ?? media?.story?.caption ?? null;
      return `[shared ${whose} ${p.kind}${caption ? `:${quoted(caption, 200)}` : ""}]`;
    }
    case "story_reply": {
      if (p.mention) return "[mentioned you in their story]";
      const s = media?.story;
      const about = s?.caption || s?.topic;
      const whose = fromMe ? "their" : "your";
      return `[replying to ${whose} story${quoted(about, 200)}]`;
    }
    case "reaction":
      return `[reacted ${p.emoji}]`;
    case "unsupported":
      return `[${p.label.toLowerCase()}]`;
  }
}

/** A whole message as one transcript string for J. Their words first, then
 *  what the media says, then the story it answers (as the old flatten did, so
 *  keyword matching on the first message still sees the bare keyword). */
export function messageText(m: RichMessage, media?: MediaView | null): string {
  if (m.deleted) return "[unsent a message]";
  const order = (p: MessagePart) => (p.type === "story_reply" ? 2 : p.type === "text" || p.type === "link" || p.type === "template" || p.type === "postback" ? 0 : 1);
  return [...m.parts]
    .sort((a, b) => order(a) - order(b))
    .map((p) => partText(p, media, m.fromMe))
    .filter((s) => s.trim())
    .join("\n");
}
