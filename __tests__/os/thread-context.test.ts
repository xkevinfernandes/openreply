import { describe, expect, it } from "vitest";
import type { MediaView } from "../../lib/os/media";
import { lastVoiceNote } from "../../lib/os/setter/drafter";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { draftForContact } from "../../lib/os/setter/service";
import { hasAttachment, newRecord, observe, type SetterRecord, type ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";
import { normaliseZernio } from "../../lib/os/setter/thread";

const TRANSCRIPT = "honestly it's mostly the same two questions over and over, how much is it and where's the link";

const raw = [
  { id: "m3", direction: "incoming", createdAt: "2026-10-19T10:02:00Z", attachments: [{ type: "audio", payload: { url: "https://cdn/v" } }] },
  { id: "m1", direction: "incoming", createdAt: "2026-10-19T10:00:00Z", message: "SETTER", storyReply: { storyId: "story-setter", storyUrl: "https://lookaside/x?asset_id=1" } },
  { id: "m2", direction: "outgoing", createdAt: "2026-10-19T10:01:00Z", message: "haha the classic. how many are you getting a day?" },
  { id: "m4", direction: "incoming", createdAt: "2026-10-19T10:03:00Z", attachments: [{ type: "image", payload: { url: "https://cdn/i" } }] },
];

const media = new Map<string, MediaView>([
  ["m3", { messageId: "m3", kind: "voice", status: "done", transcript: TRANSCRIPT, description: null, caption: null, durationMs: null, story: null }],
  ["m1", { messageId: "m1", kind: "story_reply", status: "done", transcript: null, description: null, caption: null, durationMs: null, story: { id: "story-setter", thumbnailUrl: null, caption: "Claude built my setter", topic: null, postedAt: null, permalink: null } }],
  ["m4", { messageId: "m4", kind: "image", status: "done", transcript: null, description: "a Google Calendar invite for Tue 3pm", caption: null, durationMs: null, story: null }],
]);

describe("J's thread carries media as text", () => {
  const msgs = normaliseZernio(raw, media);

  it("oldest first, every medium read as what it says", () => {
    expect(msgs.map((m) => m.id)).toEqual(["m1", "m2", "m3", "m4"]);
    expect(msgs[0].text).toBe('SETTER\n[replying to your story "Claude built my setter"]');
    expect(msgs[0].story_reply).toBe(true);
    expect(msgs[2].text).toBe(`[voice note] "${TRANSCRIPT}"`);
    expect(msgs[3].text).toBe("[photo: a Google Calendar invite for Tue 3pm]");
  });

  it("a transcribed voice note is speech; a photo still counts as their screenshot", () => {
    expect(msgs[2].attachment).toBeNull();
    expect(msgs[3].attachment).toBe("image");
    expect(hasAttachment(msgs[3])).toBe(true);
    expect(normaliseZernio(raw)[2]).toMatchObject({ text: "[voice note]", attachment: "audio" });
  });

  it("the keyword in a story reply is still read as the entry", () => {
    const rec = observe(newRecord("c", "maya"), msgs, [], [{ slug: "setter", type: "setter", name: "Setter", triggers: [{ keyword: "SETTER" }] } as never], "2026-10-19T10:05:00Z");
    expect(rec.entry).toMatchObject({ via: "setter_keyword", keyword: "setter" });
  });
});

function memoryStore(contact: SetterContact, thread: ThreadMessage[]) {
  const states = new Map<string, SetterRecord>();
  const drafts = new Map<string, DraftView>();
  let seq = 0;
  const store: SetterStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    loadState: async (id) => states.get(id) ?? null,
    saveState: async (c, rec) => void states.set(c.id, rec),
    pendingDraft: async () => null,
    createDraft: async (input: NewDraft) => {
      const d: DraftView = { ...input, id: `d${++seq}`, status: "PENDING", createdAt: new Date().toISOString() };
      drafts.set(d.id, d);
      return d;
    },
    getDraft: async (id) => drafts.get(id) ?? null,
    claimDraft: async () => true,
    markSent: async () => {},
    releaseDraft: async () => {},
    discardDraft: async () => true,
    listPending: async () => [],
    send: async () => {},
    setSetterStage: async () => {},
  };
  return store;
}

describe("a draft answers what was said in a voice note", () => {
  it("the fake drafter quotes the transcript J read", async () => {
    const contact: SetterContact = { id: "c1", workspaceId: "w1", igUserId: "1", username: "maya", conversationId: "conv", kind: "SALES", paused: false, tags: [] };
    const thread = normaliseZernio(raw.slice(0, 3), media);
    const r = await draftForContact("c1", { store: memoryStore(contact, thread), knowledge: fileKnowledgeSource(), now: new Date("2026-10-19T10:04:00Z") });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.draft.bubbles.join(" ")).toContain("honestly it's mostly the same two questions");
  });

  it("only quotes a recent voice note", () => {
    const p = (lines: string[]) => `x\n\nThe WHOLE conversation so far (n messages), oldest first:\n${lines.join("\n")}\n\nRespond`;
    expect(lastVoiceNote(p(['THEM: [voice note] "a b c"', "YOU: ok"]))).toBe("a b c");
    expect(lastVoiceNote(p(['THEM: [voice note] "a"', "YOU: 1", "THEM: 2", "YOU: 3"]))).toBeNull();
    expect(lastVoiceNote(p(["THEM: [voice note]"]))).toBeNull();
  });
});
