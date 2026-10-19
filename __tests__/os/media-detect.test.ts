import { describe, expect, it } from "vitest";
import fixture from "./fixtures/zernio-messages.json";
import { detectAll, detectMedia, messageText } from "../../lib/os/media/detect";
import type { MediaView } from "../../lib/os/media";
import { parseZernioMessage, parseZernioMessages } from "../../lib/os/messages/parse";

const view = (over: Partial<MediaView>): MediaView => ({
  messageId: "x",
  kind: "voice",
  status: "done",
  transcript: null,
  description: null,
  caption: null,
  durationMs: null,
  story: null,
  ...over,
});

describe("detectMedia", () => {
  const msgs = parseZernioMessages(fixture as unknown[]);
  const items = detectAll(msgs);

  it("finds voice, image, file, share and story reply in the spike fixture", () => {
    const kinds = new Set(items.map((i) => i.kind));
    for (const k of ["voice", "image", "file", "share", "story_reply"]) expect(kinds).toContain(k);
  });

  it("keeps the CDN url, the refreshUrl and the story ref", () => {
    const voice = items.find((i) => i.kind === "voice")!;
    expect(voice.sourceUrl).toMatch(/lookaside/);
    expect(voice.refreshUrl).toMatch(/zernio\.com/);
    const story = items.find((i) => i.kind === "story_reply" && i.direction === "incoming")!;
    expect(story.story?.storyId).toBeTruthy();
    expect(story.story?.assetId).toMatch(/^\d+$/);
  });

  it("ignores plain text, links and our button cards", () => {
    const plain = parseZernioMessage({ id: "a", direction: "incoming", message: "see https://x.com", createdAt: "2026-10-01T00:00:00Z" });
    expect(detectMedia(plain)).toBeNull();
    const card = msgs.find((m) => m.parts.some((p) => p.type === "template"))!;
    expect(detectMedia(card)).toBeNull();
  });

  it("picks voice over the story it answers", () => {
    const m = parseZernioMessage({
      id: "v1",
      direction: "incoming",
      storyReply: { storyId: "s1", storyUrl: "https://lookaside.fbsbx.com/x?asset_id=12" },
      attachments: [{ type: "audio", payload: { url: "https://cdn/v.mp4" } }],
    });
    expect(detectMedia(m)?.kind).toBe("voice");
  });
});

describe("messageText: J reads media as text", () => {
  it("voice note with its transcript", () => {
    const m = parseZernioMessage({ id: "v", direction: "incoming", attachments: [{ type: "audio", payload: { url: "u" } }] });
    expect(messageText(m, view({ transcript: "it's mostly the same two questions" }))).toBe('[voice note] "it\'s mostly the same two questions"');
    expect(messageText(m, null)).toBe("[voice note]");
  });

  it("photo with its description", () => {
    const m = parseZernioMessage({ id: "p", direction: "incoming", attachments: [{ type: "image", payload: { url: "u" } }] });
    expect(messageText(m, view({ kind: "image", description: "a calendar invite for Tue 3pm" }))).toBe("[photo: a calendar invite for Tue 3pm]");
    expect(messageText(m)).toBe("[photo]");
  });

  it("shared reel with its caption; ours when Data OS knows it", () => {
    const m = parseZernioMessage({ id: "r", direction: "incoming", attachments: [{ type: "video", payload: { reel_video_id: "9", url: "https://www.instagram.com/reel/x/", title: "I let Claude set my DMs" } }] });
    expect(messageText(m)).toBe('[shared a reel: "I let Claude set my DMs"]');
    const story = { id: "9", thumbnailUrl: null, caption: "I let Claude set my DMs", topic: null, postedAt: null, permalink: null };
    expect(messageText(m, view({ kind: "share", story }))).toBe('[shared your reel: "I let Claude set my DMs"]');
  });

  it("story reply with the story's caption, keyword first", () => {
    const m = parseZernioMessage({ id: "s", direction: "incoming", message: "SETTER", storyReply: { storyId: "s1", storyUrl: "u" } });
    expect(messageText(m)).toBe("SETTER\n[replying to your story]");
    const story = { id: "s1", thumbnailUrl: null, caption: "Claude built my setter", topic: "AI setter", postedAt: null, permalink: null };
    expect(messageText(m, view({ kind: "story_reply", story }))).toBe('SETTER\n[replying to your story "Claude built my setter"]');
  });

  it("button cards and taps read as before", () => {
    const m = parseZernioMessage({
      id: "t",
      direction: "outgoing",
      attachments: [{ type: "template", payload: { generic: { elements: [{ title: "Guide", buttons: [{ type: "web_url", title: "Get it", url: "https://k.me/g" }] }] } } }],
    });
    expect(messageText(m)).toBe("Guide\n[button: Get it -> https://k.me/g]");
    const tap = parseZernioMessage({ id: "postback_1", direction: "incoming", metadata: { postbackTitle: "Get it" } });
    expect(messageText(tap)).toBe("[they tapped: Get it]");
  });
});
