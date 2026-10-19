import { describe, expect, it } from "vitest";
import fixture from "./fixtures/zernio-messages.json";
import { assetIdOf, messagePreview, parseZernioMessage, parseZernioMessages, partLabel, splitLinks } from "@/lib/os/messages/parse";
import type { MessagePart } from "@/lib/os/messages/types";

type Raw = Record<string, unknown>;
const raw = fixture as Raw[];
const find = (pred: (m: Raw) => boolean) => {
  const m = raw.find(pred);
  if (!m) throw new Error("fixture shape missing");
  return m;
};
const att = (m: Raw) => ((m.attachments as Raw[] | undefined) ?? [])[0] as Raw | undefined;
const payload = (m: Raw) => (att(m)?.payload ?? {}) as Raw;
const types = (parts: MessagePart[]) => parts.map((p) => p.type);

describe("parseZernioMessage on the spike fixture", () => {
  it("parses every real message without throwing and with an id", () => {
    for (const m of raw) {
      const r = parseZernioMessage(m);
      expect(r.id).toBeTruthy();
      expect(r.direction === "incoming" || r.direction === "outgoing").toBe(true);
      if (!r.deleted) expect(r.parts.length).toBeGreaterThan(0);
    }
  });

  it("plain text", () => {
    const m = find((x) => typeof x.message === "string" && x.message !== "" && !x.metadata && !x.storyReply && !/https?:/.test(String(x.message)) && !(x.attachments as unknown[]).length);
    expect(parseZernioMessage(m).parts).toEqual([{ type: "text", text: m.message }]);
  });

  it("story reply carries storyId and the CDN asset id", () => {
    const m = find((x) => !!x.storyReply && x.message !== "");
    const r = parseZernioMessage(m);
    expect(r.parts[0]).toMatchObject({ type: "story_reply", storyId: (m.storyReply as Raw).storyId, mention: false });
    expect((r.parts[0] as { assetId: string | null }).assetId).toMatch(/^\d+$/);
    expect(r.parts[1]).toEqual({ type: "text", text: m.message });
  });

  it("story reply with no text is just the story", () => {
    const m = find((x) => !!x.storyReply && x.message === "");
    expect(types(parseZernioMessage(m).parts)).toEqual(["story_reply"]);
  });

  it("generic template: title and stacked buttons (postback and open_url)", () => {
    const m = find((x) => att(x)?.type === "template");
    const p = parseZernioMessage(m).parts[0];
    expect(p.type).toBe("template");
    if (p.type !== "template") return;
    expect(p.title).toBeTruthy();
    expect(p.buttons.length).toBeGreaterThan(0);
    for (const b of p.buttons) expect(b.kind === "url" ? b.url : b.payload).toBeTruthy();
  });

  it("text sent with buttons (metaInteractive) is one card, not text + buttons", () => {
    const m = find((x) => !!(x.metadata as Raw | undefined)?.metaInteractive);
    const r = parseZernioMessage(m);
    expect(types(r.parts)).toEqual(["template"]);
    expect(r.parts[0]).toMatchObject({ type: "template", title: m.message, buttons: [expect.objectContaining({ kind: "url" })] });
    expect(r.origin).not.toBeUndefined();
  });

  it("reel share (video + reel_video_id) with caption", () => {
    const m = find((x) => att(x)?.type === "video" && !!payload(x).reel_video_id && !!payload(x).title);
    expect(parseZernioMessage(m).parts).toEqual([{ type: "share", kind: "reel", mediaId: payload(m).reel_video_id, url: payload(m).url, caption: payload(m).title }]);
  });

  it("post share (ig_post_media_id)", () => {
    const m = find((x) => att(x)?.type === "share" && !!payload(x).ig_post_media_id);
    expect(parseZernioMessage(m).parts[0]).toMatchObject({ type: "share", kind: "post", mediaId: payload(m).ig_post_media_id, caption: payload(m).title });
  });

  it("story share (story_media_id)", () => {
    const m = find((x) => att(x)?.type === "share" && !!payload(x).story_media_id);
    expect(parseZernioMessage(m).parts[0]).toMatchObject({ type: "share", kind: "story", mediaId: payload(m).story_media_id });
  });

  it("voice note is type audio, no duration", () => {
    const m = find((x) => att(x)?.type === "audio");
    expect(parseZernioMessage(m).parts).toEqual([{ type: "voice", url: payload(m).url, durationMs: null }]);
  });

  it("image, plain video and file", () => {
    expect(types(parseZernioMessage(find((x) => att(x)?.type === "image")).parts)).toEqual(["image"]);
    expect(types(parseZernioMessage(find((x) => att(x)?.type === "video" && !payload(x).reel_video_id)).parts)).toEqual(["video"]);
    expect(types(parseZernioMessage(find((x) => att(x)?.type === "file")).parts)).toEqual(["file"]);
  });

  it("postback: they tapped a button", () => {
    const m = find((x) => !!(x.metadata as Raw | undefined)?.postbackTitle);
    const r = parseZernioMessage(m);
    expect(r.parts).toEqual([{ type: "postback", title: (m.metadata as Raw).postbackTitle, payload: (m.metadata as Raw).postbackPayload }]);
  });

  it("reactions sit on the reacted message", () => {
    const m = find((x) => Array.isArray(x.reactions) && (x.reactions as unknown[]).length > 0);
    const r = parseZernioMessage(m);
    expect(r.reactions[0]).toMatchObject({ emoji: "❤", fromMe: false });
    expect(r.reactions[0].at).toBeTruthy();
  });

  it("seen comes from readAt on outgoing messages only", () => {
    const out = find((x) => x.direction === "outgoing" && !!x.readAt);
    expect(parseZernioMessage(out).seenAt).toBe(out.readAt);
    expect(parseZernioMessage(out).deliveryStatus).toBe("read");
    const inc = find((x) => x.direction === "incoming");
    expect(parseZernioMessage(inc).seenAt).toBeNull();
  });

  it("deleted messages have no parts; empty renderable content degrades to a label", () => {
    const del = find((x) => x.isDeleted === true);
    expect(parseZernioMessage(del)).toMatchObject({ deleted: true, parts: [] });
    expect(messagePreview(parseZernioMessage(del))).toBe("Unsent a message");
    const none = find((x) => x.noRenderableContent === true);
    expect(parseZernioMessage(none).parts[0]).toMatchObject({ type: "unsupported" });
  });

  it("quoted replies and automation ids come through", () => {
    const q = find((x) => !!(x.metadata as Raw | undefined)?.quotedMessageId);
    expect(parseZernioMessage(q).quotedMessageId).toBe((q.metadata as Raw).quotedMessageId);
    const a = find((x) => !!(x.metadata as Raw | undefined)?.automationId);
    expect(parseZernioMessage(a)).toMatchObject({ origin: "automation", automationId: (a.metadata as Raw).automationId });
  });

  it("fromSetter only for outgoing ids in the setter list", () => {
    const out = find((x) => x.direction === "outgoing" && typeof x.message === "string" && x.message !== "");
    expect(parseZernioMessage(out).fromSetter).toBe(false);
    expect(parseZernioMessage(out, { setterMessageIds: new Set([String(out.id)]) }).fromSetter).toBe(true);
    const inc = find((x) => x.direction === "incoming");
    expect(parseZernioMessage(inc, { setterMessageIds: new Set([String(inc.id)]) }).fromSetter).toBe(false);
  });

  it("parseZernioMessages sorts oldest first", () => {
    const list = parseZernioMessages(raw);
    for (let i = 1; i < list.length; i++) expect((list[i - 1].at ?? "") <= (list[i].at ?? "")).toBe(true);
  });
});

describe("degrading gracefully", () => {
  it("unknown attachment types and junk input", () => {
    expect(parseZernioMessage({ id: "x", direction: "incoming", attachments: [{ type: "sticker" }] }).parts).toEqual([{ type: "unsupported", label: "Sent an attachment" }]);
    expect(parseZernioMessage(null).parts[0].type).toBe("unsupported");
    expect(parseZernioMessage({ id: "y", attachments: "nope", reactions: [{}], metadata: 3 }).reactions).toEqual([]);
  });

  it("isStoryMention without storyReply", () => {
    expect(parseZernioMessage({ id: "z", direction: "incoming", isStoryMention: true }).parts[0]).toMatchObject({ type: "story_reply", mention: true, storyId: null });
  });

  it("template with image and subtitle", () => {
    const r = parseZernioMessage({
      id: "t",
      direction: "outgoing",
      attachments: [{ type: "template", payload: { generic: { elements: [{ title: "Guide", subtitle: "Free", image_url: "https://x/y.png", buttons: [{ type: "web_url", title: "Get it", url: "https://x" }] }] } } }],
    });
    expect(r.parts[0]).toEqual({ type: "template", image: "https://x/y.png", title: "Guide", subtitle: "Free", buttons: [{ title: "Get it", url: "https://x", payload: null, kind: "url" }] });
  });
});

describe("links get their own bubble", () => {
  it("splits text around URLs and trims trailing punctuation", () => {
    expect(splitLinks("here you go https://kevinfernandes.me/script-vault. enjoy")).toEqual([
      { type: "text", text: "here you go" },
      { type: "link", url: "https://kevinfernandes.me/script-vault", domain: "kevinfernandes.me", title: null },
      { type: "text", text: ". enjoy" },
    ]);
    expect(splitLinks("https://www.a.com/x https://b.io")).toHaveLength(2);
    expect(splitLinks("no links")).toEqual([{ type: "text", text: "no links" }]);
  });

  it("asset ids and labels", () => {
    expect(assetIdOf("https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=123&signature=x")).toBe("123");
    expect(assetIdOf(null)).toBeNull();
    expect(partLabel({ type: "share", kind: "reel", mediaId: null, url: null, caption: null })).toBe("Sent a reel");
    expect(partLabel({ type: "voice", url: null, durationMs: null })).toBe("Voice note");
  });
});
