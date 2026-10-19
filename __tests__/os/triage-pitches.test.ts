// Pitches: people selling to Kevin and other creators' automations. The three
// named cases from the handoff (forseth.ai, ryansterling, ravsharmaofficial)
// were read as sales by Jev; these threads reproduce their shapes (real
// payloads were not pulled into fixtures).
import { describe, expect, it, vi } from "vitest";
import type { ContactKind } from "../../app/generated/prisma/enums";
import type { ThreadMessage } from "../../lib/os/setter/state";
import { normaliseZernio } from "../../lib/os/setter/thread";
import { pitchCheck, resortPitches, triageContact, type ResortCandidate, type TriageContact, type TriageStore, type TriageUpdate } from "../../lib/os/setter/triage";

const t = (min: number, sec = 0) => `2026-10-18T10:${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}Z`;
const m = (id: string, text: string, incoming: boolean, at: string, extra: Partial<ThreadMessage> = {}): ThreadMessage => ({ id, text, incoming, at, ...extra });

/** forseth.ai: their automation DMs Kevin a button card. */
const forseth = normaliseZernio([
  {
    id: "f1",
    direction: "incoming",
    createdAt: t(0),
    attachments: [{ type: "template", payload: { generic: { elements: [{ title: "Your free AI agent blueprint", buttons: [{ type: "web_url", title: "Get it", url: "https://forseth.ai/blueprint" }] }] } } }],
  },
  { id: "f2", direction: "incoming", createdAt: t(1), message: "want me to walk you through it on a call?" },
]);

/** ryansterling: Kevin typed his keyword, his automation answered in seconds. */
const ryan: ThreadMessage[] = [
  m("r1", "SYSTEM", false, t(0)),
  m("r2", "here's the system I promised 👇 https://ryansterling.com/system", true, t(0, 6)),
  m("r3", "how much is your coaching btw", true, t(5)),
];

/** ravsharmaofficial: wrote first, cold, selling. */
const rav: ThreadMessage[] = [
  m("v1", "hey bro love your content! we help coaches 3x your leads with done-for-you DM funnels", true, t(0)),
  m("v2", "would you be open to a quick call?", true, t(1)),
];

/** A real lead: commented the keyword, our opener first. */
const lead: ThreadMessage[] = [
  m("l1", "here you go 👇 https://kevinfernandes.me/setter-starter", false, t(0)),
  m("l2", "thanks! how much is your coaching?", true, t(3)),
];

describe("pitchCheck: who wrote first", () => {
  it("their side sends a button card", () => {
    expect(forseth[0].card).toBe(true);
    expect(pitchCheck(forseth)).toMatchObject({ pitch: true, strong: true, firstFrom: "them" });
  });

  it("Kevin typed their keyword and a link came back within two minutes", () => {
    expect(pitchCheck(ryan)).toMatchObject({ pitch: true, strong: true, firstFrom: "kevin" });
    const slow = [ryan[0], { ...ryan[1], at: t(30) }];
    expect(pitchCheck(slow).pitch).toBe(false);
  });

  it("they wrote first with a pitch (not certain on its own)", () => {
    expect(pitchCheck(rav)).toMatchObject({ pitch: true, strong: false, firstFrom: "them" });
  });

  it("leads from Kevin's own funnel are never pitches by rule", () => {
    expect(pitchCheck(lead).pitch).toBe(false);
    expect(pitchCheck(rav, "comment").pitch).toBe(false);
    expect(pitchCheck([m("a", "hey! saw your reel about the AI setter", true, t(0))]).pitch).toBe(false);
  });
});

function store(contact: TriageContact, thread: ThreadMessage[]) {
  const saves: TriageUpdate[] = [];
  const s: TriageStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    save: async (_id, kind, u) => {
      if (kind !== contact.kind) return;
      saves.push(u);
      if (u.kind) contact.kind = u.kind;
    },
  };
  return { s, saves };
}

const contact = (kind: ContactKind, over: Partial<TriageContact> = {}): TriageContact => ({
  id: "c1",
  workspaceId: "w1",
  igUserId: "1",
  username: "x",
  conversationId: "conv",
  kind,
  tags: [],
  triagedMessageId: null,
  ...over,
});
const now = new Date("2026-10-18T11:00:00Z");

describe("triageContact sorts pitches into Pitches", () => {
  it("forseth.ai and ryansterling move without a model call", async () => {
    for (const thread of [forseth, ryan]) {
      const c = contact("UNSORTED");
      const { s, saves } = store(c, thread);
      const fetch = vi.fn();
      const r = await triageContact("c1", { store: s, now, backend: "jev", jev: { fetch: fetch as unknown as typeof globalThis.fetch, env: { OPENROUTER_API_KEY: "k" } } });
      expect(r).toMatchObject({ status: "pitch", kind: "PITCHES" });
      expect(fetch).not.toHaveBeenCalled();
      expect(saves[0]).toMatchObject({ kind: "PITCHES", kindSource: "triage", suggestedKind: null });
      expect(c.kind).toBe("PITCHES");
    }
  });

  it("ravsharmaofficial: the LLM's pitch verdict moves it", async () => {
    const c = contact("UNSORTED");
    const { s } = store(c, rav);
    const r = await triageContact("c1", { store: s, now });
    expect(r).toMatchObject({ status: "pitch", kind: "PITCHES" });
  });

  it("a cold pitch Jev reads as sales still lands in Pitches (who wrote first)", async () => {
    const c = contact("UNSORTED");
    const { s } = store(c, rav);
    const answers = { kind: { choice: "sales", confidence: 0.9, probabilities: { sales: 0.9, personal: 0.05, pitch: 0.05 } } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ answers }), { status: 200 }));
    const r = await triageContact("c1", { store: s, now, backend: "jev", jev: { fetch: fetch as unknown as typeof globalThis.fetch, env: { OPENROUTER_API_KEY: "k" } } });
    expect(r).toMatchObject({ status: "pitch" });
  });

  it("Jev's own pitch answer moves it", async () => {
    const c = contact("UNSORTED");
    const { s } = store(c, [m("a", "hi Kevin, quick question about a partnership", true, t(0))]);
    const answers = { kind: { choice: "pitch", confidence: 0.88, probabilities: { sales: 0.07, personal: 0.05, pitch: 0.88 } } };
    const fetch = vi.fn(async () => new Response(JSON.stringify({ answers }), { status: 200 }));
    const r = await triageContact("c1", { store: s, now, backend: "jev", jev: { fetch: fetch as unknown as typeof globalThis.fetch, env: { OPENROUTER_API_KEY: "k" } } });
    expect(r).toMatchObject({ status: "pitch", confidence: 0.88 });
  });

  it("a real lead stays a sales suggestion", async () => {
    const c = contact("UNSORTED", { entryPath: "comment" });
    const { s } = store(c, lead);
    const r = await triageContact("c1", { store: s, now });
    expect(r).toMatchObject({ status: "suggested", kind: "SALES" });
    expect(c.kind).toBe("UNSORTED");
  });

  it("a contact already in Pitches is left alone", async () => {
    const { s, saves } = store(contact("PITCHES"), forseth);
    expect((await triageContact("c1", { store: s, now })).status).toBe("skipped");
    expect(saves).toHaveLength(0);
  });
});

describe("resortPitches", () => {
  const cand = (id: string, kind: ContactKind, over: Partial<ResortCandidate> = {}): ResortCandidate => ({ ...contact(kind), id, username: id, kindSource: null, ...over });

  function multiStore(threads: Record<string, ThreadMessage[]>, contacts: ResortCandidate[]) {
    const writes: { id: string; u: TriageUpdate }[] = [];
    const s: TriageStore = {
      getContact: async (id) => contacts.find((c) => c.id === id) ?? null,
      readThread: async (c) => threads[c.id] ?? [],
      save: async (id, _kind, u) => void writes.push({ id, u }),
    };
    return { s, writes };
  }

  it("moves pitches out of Unsorted and (only on the certain rule) Sales; keeps Kevin's choices", async () => {
    const contacts = [
      cand("forseth.ai", "UNSORTED"),
      cand("ryansterling", "SALES", { kindSource: "triage" }),
      cand("ravsharmaofficial", "SALES", { kindSource: "entry" }),
      cand("maya", "SALES", { kindSource: "entry", entryPath: "comment" }),
      cand("kevin-chose", "SALES", { kindSource: "user" }),
    ];
    const { s, writes } = multiStore({ "forseth.ai": forseth, ryansterling: ryan, ravsharmaofficial: rav, maya: lead, "kevin-chose": forseth }, contacts);
    const r = await resortPitches("w1", { store: s, candidates: contacts, now });
    expect(r.moved.map((x) => x.contactId).sort()).toEqual(["forseth.ai", "ryansterling"]);
    expect(r.looked).toBe(4);
    expect(writes.filter((w) => w.u.kind === "PITCHES").map((w) => w.id).sort()).toEqual(["forseth.ai", "ryansterling"]);
  });

  it("dry run writes nothing", async () => {
    const contacts = [cand("forseth.ai", "UNSORTED")];
    const saves: string[] = [];
    const s: TriageStore = {
      getContact: async () => contacts[0],
      readThread: async () => forseth,
      save: async (id) => void saves.push(id),
    };
    const r = await resortPitches("w1", { store: s, candidates: contacts, dryRun: true, now });
    expect(r.moved).toHaveLength(1);
    expect(saves).toHaveLength(0);
  });
});
