import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { approveDraft, draftForContact } from "../../lib/os/setter/service";
import { fileKnowledgeSource } from "../../lib/os/setter/knowledge";
import { newRecord, type ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";
import { AUDIO_ID, audioDuration, encodeWav, sampleToneWav, sniffAudio } from "../../lib/os/voice/audio";
import { findPhrase, matchable, normalise, planBubbles, voiceBlock, type BankClip } from "../../lib/os/voice/match";
import { serveVoice } from "../../lib/os/voice/serve";
import { VOICE_SLOTS } from "../../lib/os/voice/slots";
import type { VoiceBank } from "../../lib/os/voice/store";
import type { ExperimentStore } from "../../lib/os/experiments/store";

const clip = (id: string, phrase: string, extra: Partial<BankClip> = {}): BankClip => ({
  id,
  label: id,
  phrase,
  leadIn: false,
  audioId: `a-${id}`,
  ext: "m4a",
  url: `/api/os/voice/a-${id}.m4a`,
  durationMs: 3000,
  ...extra,
});

const goal = clip("v04", "what's the main goal with the business right now?");
const withMe = clip("v13", "hey, still with me?");
const gym = clip("v14", "just headed to the gym, quick one..", { leadIn: true });

describe("phrase matching", () => {
  it("normalises case, apostrophes, punctuation and accents", () => {
    expect(normalise("What’s the MAIN goal?!")).toBe("whats the main goal");
    expect(normalise("  café — résumé ")).toBe("cafe resume");
    expect(normalise("hey 👋 still with me")).toBe("hey still with me");
  });

  it("is a word-boundary contains-match", () => {
    expect(findPhrase("ok cool. Whats the main goal with the business right now", goal.phrase)).not.toBeNull();
    expect(findPhrase("hey, still with me? no rush", withMe.phrase)).toEqual([0, 19]);
    // A word that merely contains the phrase's last word doesn't count.
    expect(findPhrase("hey still with meredith", withMe.phrase)).toBeNull();
    expect(findPhrase("what's the goal", goal.phrase)).toBeNull();
  });

  it("lead-ins only match at the start of a bubble", () => {
    expect(findPhrase("just headed to the gym, quick one.. how did it go?", gym.phrase, true)).not.toBeNull();
    expect(findPhrase("haha just headed to the gym, quick one..", gym.phrase, true)).toBeNull();
  });

  it("never auto-matches lines under 3 words", () => {
    expect(matchable("hey")).toBe(false);
    expect(matchable("still with me?")).toBe(true);
    expect(planBubbles(["hey"], [clip("x", "hey")])).toEqual([[{ type: "text", text: "hey" }]]);
  });

  it("swaps the line for the clip and keeps the words around it", () => {
    const plan = planBubbles(["haha love that. What's the main goal with the business right now?", "no pressure"], [goal]);
    expect(plan[0]).toEqual([
      { type: "text", text: "haha love that." },
      { type: "voice", clip: goal },
    ]);
    expect(plan[1]).toEqual([{ type: "text", text: "no pressure" }]);
  });

  it("a lead-in plays first and the rest of the bubble follows as text", () => {
    const [b] = planBubbles(["just headed to the gym, quick one.. did you get to watch it?"], [gym]);
    expect(b).toEqual([
      { type: "voice", clip: gym },
      { type: "text", text: "did you get to watch it?" },
    ]);
  });

  it("plays a clip at most once per draft, and never to someone who heard it", () => {
    const twice = planBubbles(["hey, still with me?", "hey still with me"], [withMe]);
    expect(twice.flat().filter((p) => p.type === "voice")).toHaveLength(1);
    expect(planBubbles(["hey, still with me?"], [withMe], ["v13"])).toEqual([[{ type: "text", text: "hey, still with me?" }]]);
  });

  it("ignores clips without audio", () => {
    expect(planBubbles(["hey, still with me?"], [{ ...withMe, audioId: "" }])).toEqual([[{ type: "text", text: "hey, still with me?" }]]);
  });

  it("teaches J the unheard lines, lead-ins apart", () => {
    const block = voiceBlock([goal, gym], "@sam", "Kevin");
    expect(block).toContain("VOICE NOTES");
    expect(block).toContain(`- "${goal.phrase}"`);
    expect(block).toMatch(/Lead-ins[^\n]*\n- "just headed to the gym/);
    expect(voiceBlock([], "@sam")).toBe("");
  });

  it("ships the 15 lines from the v2 plan, all matchable", () => {
    expect(VOICE_SLOTS.map((s) => s.slot)).toEqual(Array.from({ length: 15 }, (_, i) => `v${String(i + 1).padStart(2, "0")}`));
    expect(VOICE_SLOTS.every((s) => matchable(s.phrase))).toBe(true);
    expect(VOICE_SLOTS.find((s) => s.slot === "v14")?.leadIn).toBe(true);
  });
});

describe("audio files", () => {
  it("tells formats apart by their bytes", () => {
    expect(sniffAudio(sampleToneWav())).toBe("wav");
    const m4a = new Uint8Array([0, 0, 0, 0x20, ...Buffer.from("ftypM4A "), 0, 0, 0, 0]);
    expect(sniffAudio(m4a)).toBe("m4a");
    expect(sniffAudio(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
    expect(sniffAudio(new Uint8Array([...Buffer.from("ID3"), 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });

  it("reads a WAV's length from its header", () => {
    expect(audioDuration(encodeWav(new Float32Array(22050), 22050), "wav")).toBe(1000);
    expect(audioDuration(sampleToneWav(1.6), "wav")).toBe(1600);
  });
});

describe("storage route", () => {
  const id = "A".repeat(16) + "b_-9".repeat(4);
  const bytes = sampleToneWav(0.2);
  const load = async (key: string) => (key === id ? { mimeType: "audio/wav", ext: "wav", bytes } : null);
  const get = (file: string, headers: Record<string, string> = {}) => serveVoice(new Request(`https://x/api/os/voice/${file}`, { headers }), file, load);

  it("serves a file by its unguessable id, publicly and cacheably", async () => {
    expect(AUDIO_ID.test(id)).toBe(true);
    const res = await get(`${id}.wav`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/wav");
    expect(res.headers.get("cache-control")).toContain("immutable");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it("404s anything else without saying why", async () => {
    for (const f of [`${id}.m4a`, `${id}`, `${"A".repeat(31)}.wav`, "../etc/passwd", `${id}.wav.html`, `${"B".repeat(32)}.wav`]) {
      const res = await get(f);
      expect(res.status, f).toBe(404);
      expect(await res.text()).toBe("Not found");
    }
  });

  it("answers byte ranges (Safari's player needs them)", async () => {
    const res = await get(`${id}.wav`, { range: "bytes=0-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${bytes.length}`);
    expect((await res.arrayBuffer()).byteLength).toBe(10);
    expect((await get(`${id}.wav`, { range: `bytes=${bytes.length + 5}-` })).status).toBe(416);
  });

  it("has no listing route", () => {
    const dir = path.resolve(__dirname, "../../app/(os)/api/os/voice");
    expect(existsSync(path.join(dir, "[file]/route.ts"))).toBe(true);
    expect(existsSync(path.join(dir, "route.ts"))).toBe(false);
  });
});

// ---------------------------------------------------------------- J's approve path
function memoryStore(contact: SetterContact, thread: ThreadMessage[]) {
  const drafts = new Map<string, DraftView>();
  const sent: string[] = [];
  let seq = 0;
  const store: SetterStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    // They wrote a minute ago: the 24h window is open.
    loadState: async () => ({ ...newRecord("conv1", "sam", contact.id), their_last_at: new Date(Date.now() - 60_000).toISOString() }),
    saveState: async () => {},
    pendingDraft: async (id) => [...drafts.values()].find((d) => d.contactId === id && d.status === "PENDING") ?? null,
    createDraft: async (input: NewDraft) => {
      const d: DraftView = { ...input, id: `d${++seq}`, status: "PENDING", createdAt: new Date().toISOString() };
      drafts.set(d.id, d);
      return d;
    },
    getDraft: async (id) => drafts.get(id) ?? null,
    claimDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "APPROVED";
      return true;
    },
    markSent: async (id, s) => void Object.assign(drafts.get(id)!, { status: "SENT", bubbles: s.bubbles }),
    releaseDraft: async (id) => void (drafts.get(id)!.status = "PENDING"),
    discardDraft: async () => true,
    listPending: async () => [],
    send: async (_c, text) => void sent.push(`text:${text}`),
    setSetterStage: async () => {},
  };
  const add = (bubbles: string[]) => {
    const d: DraftView = {
      id: `d${++seq}`, contactId: contact.id, kind: "reply", anchor: `a${seq}`, bubbles, status: "PENDING",
      reasoning: null, setterStage: null, humanAgent: false, flags: [], backend: "fake", createdAt: new Date().toISOString(), setterId: "s1",
    };
    drafts.set(d.id, d);
    return d;
  };
  return { store, sent, add };
}

function memoryBank(clips: BankClip[], sent: string[], opts: { failAudio?: boolean } = {}) {
  const heard = new Map<string, string>(); // bankKey -> sendId
  const log: { id: string; clipId: string; status: string; messageId: string | null }[] = [];
  let n = 0;
  const bank: VoiceBank = {
    load: async (c, setterId) => ({ clips: setterId === "s1" ? clips : [], heard: log.filter((l) => l.status !== "released").map((l) => l.clipId) }),
    claim: async (c) => {
      const key = `${c.contactId}:${c.clip.id}`;
      if (heard.has(key)) return null;
      const id = `vs${++n}`;
      heard.set(key, id);
      log.push({ id, clipId: c.clip.id, status: "sending", messageId: null });
      return id;
    },
    release: async (id) => {
      const row = log.find((l) => l.id === id)!;
      row.status = "released";
      for (const [k, v] of heard) if (v === id) heard.delete(k);
    },
    sendAudio: async (_c, clip) => {
      if (opts.failAudio) throw new Error("Zernio down");
      sent.push(`voice:${clip.id}`);
      return `mid-${clip.id}`;
    },
    sent: async (id, messageId) => void Object.assign(log.find((l) => l.id === id)!, { status: "sent", messageId }),
  };
  return { bank, log };
}

const contact: SetterContact = { id: "c1", workspaceId: "w1", igUserId: "101", username: "sam", conversationId: "conv1", kind: "SALES", paused: false, tags: [] };

describe("draft → voice on Approve", () => {
  it("sends the recording in place of the line, text around it, in order", async () => {
    const { store, sent, add } = memoryStore(contact, []);
    const { bank, log } = memoryBank([goal, withMe], sent);
    const d = add(["ha nice", "what's the main goal with the business right now?"]);
    const r = await approveDraft(d.id, "w1", { store, voice: bank, gapMs: 0 });
    expect(r.error).toBeUndefined();
    expect(sent).toEqual(["text:ha nice", "voice:v04"]);
    expect(log).toEqual([{ id: "vs1", clipId: "v04", status: "sent", messageId: "mid-v04" }]);
  });

  it("plays a line once per person: the next draft with it goes as text", async () => {
    const { store, sent, add } = memoryStore(contact, []);
    const { bank } = memoryBank([withMe], sent);
    await approveDraft(add(["hey, still with me?"]).id, "w1", { store, voice: bank, gapMs: 0 });
    await approveDraft(add(["hey still with me?"]).id, "w1", { store, voice: bank, gapMs: 0 });
    expect(sent).toEqual(["voice:v13", "text:hey still with me?"]);
  });

  it("an edited draft is matched too", async () => {
    const { store, sent, add } = memoryStore(contact, []);
    const { bank } = memoryBank([withMe], sent);
    await approveDraft(add(["you there?"]).id, "w1", { store, voice: bank, gapMs: 0, editedText: "hey, still with me?\n\nno rush" });
    expect(sent).toEqual(["voice:v13", "text:no rush"]);
  });

  it("a failed audio send frees the claim and keeps the draft for retry", async () => {
    const { store, sent, add } = memoryStore(contact, []);
    const { bank, log } = memoryBank([withMe], sent, { failAudio: true });
    const d = add(["hey, still with me?"]);
    const r = await approveDraft(d.id, "w1", { store, voice: bank, gapMs: 0 });
    expect(r.error).toContain("Zernio down");
    expect(log[0]!.status).toBe("released");
    expect((await store.getDraft(d.id, "w1"))!.status).toBe("PENDING");
  });

  it("an A/B line that goes out as a voice note still counts as sent", async () => {
    const { store, sent, add } = memoryStore(contact, []);
    const { bank } = memoryBank([withMe], sent);
    const marked: { text: string }[] = [];
    const experiments = {
      get: async () => ({ id: "e1", variants: [{ id: "vB", text: "hey, still with me?" }] }),
      findAssignment: async () => null,
      createAssignment: async () => ({ variantId: "vB", sentAt: null }),
      markSent: async (_e: string, _p: unknown, s: { text: string }) => void marked.push(s),
    } as unknown as ExperimentStore;
    const d = { ...add(["hey, still with me?"]), abVariants: [{ experimentId: "e1", variantId: "vB", slot: "line:follow_up_1", used: true }] };
    await approveDraft(d.id, "w1", { store: { ...store, getDraft: async () => d }, voice: bank, experiments, gapMs: 0 });
    expect(sent).toEqual(["voice:v13"]);
    expect(marked.map((m) => m.text)).toEqual(["hey, still with me?"]);
  });

  it("without a voice bank everything goes as text (existing behaviour)", async () => {
    const { store, sent, add } = memoryStore(contact, []);
    await approveDraft(add(["hey, still with me?"]).id, "w1", { store, gapMs: 0 });
    expect(sent).toEqual(["text:hey, still with me?"]);
  });

  it("J's prompt carries the unheard lines, and the fake drafter uses one word for word", async () => {
    const thread: ThreadMessage[] = [{ id: "m1", text: "hey! saw your reel", incoming: true, at: "2026-10-18T10:00:00Z" }];
    const { store } = memoryStore(contact, thread);
    const { bank } = memoryBank([goal], []);
    const knowledge = fileKnowledgeSource();
    const withSetter = { ...knowledge, forContact: async (c: SetterContact) => ({ ...(await knowledge.forContact(c)), setterId: "s1" }) };
    const prev = process.env.OS_DRAFTER;
    process.env.OS_DRAFTER = "fake";
    try {
      const r = await draftForContact("c1", { store, voice: bank, knowledge: withSetter, force: true, now: new Date("2026-10-18T10:05:00Z") });
      expect(r.status).toBe("drafted");
      if (r.status === "drafted") expect(r.draft.bubbles).toContain(goal.phrase);
    } finally {
      if (prev === undefined) delete process.env.OS_DRAFTER;
      else process.env.OS_DRAFTER = prev;
    }
  });
});
