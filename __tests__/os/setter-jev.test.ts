import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContactKind } from "../../app/generated/prisma/enums";
import { ask, jevConfigured, jevModel, jevProvider, JevError, readChoice, readNoul } from "../../lib/os/setter/jev";
import type { ThreadMessage } from "../../lib/os/setter/state";
import {
  DEFAULT_JEV_MIN,
  jevMin,
  resolveTriageBackend,
  triageContact,
  triageHint,
  type TriageContact,
  type TriageStore,
  type TriageUpdate,
} from "../../lib/os/setter/triage";
import { isUnsure, jevReason, parseJevReason, triageCopy } from "../../lib/os/triage-copy";

const KEY_ENV = { OPENROUTER_API_KEY: "test-key" };

type Call = { url: string; init: RequestInit; body: Record<string, unknown> };

function mockFetch(...responses: Array<{ status?: number; json?: unknown; text?: string } | Error>) {
  const calls: Call[] = [];
  let i = 0;
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {}, body: JSON.parse(String(init?.body ?? "{}")) });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    const status = r.status ?? 200;
    return new Response(r.text ?? JSON.stringify(r.json ?? {}), { status, headers: { "Content-Type": "application/json" } });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

describe("jev client", () => {
  it("defaults to OpenRouter's decisions endpoint and jev-1.13", () => {
    expect(jevProvider({})).toMatchObject({ name: "openrouter", url: "https://openrouter.ai/api/alpha/decisions" });
    expect(jevModel({})).toBe("typesafe/jev-1.13");
    expect(jevModel({ JEV_MODEL: "typesafe/jev-2" })).toBe("typesafe/jev-2");
    expect(jevProvider({ TYPESAFE_API_KEY: "k" }).name).toBe("typesafe");
    expect(jevProvider({ JEV_PROVIDER: "typesafe" }).url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(() => jevProvider({ JEV_PROVIDER: "nope" })).toThrow(JevError);
    expect(jevConfigured({})).toBe(false);
    expect(jevConfigured(KEY_ENV)).toBe(true);
    expect(jevConfigured({ JEV_PROVIDER: "typesafe", OPENROUTER_API_KEY: "k" })).toBe(false);
  });

  it("posts state + model + questions with a bearer key and returns answers", async () => {
    const m = mockFetch({ json: { answers: { kind: { choice: "sales", confidence: 0.9 } } } });
    const q = { kind: { type: "choice" as const, instructions: "i", criteria: { sales: "s", personal: "p" } } };
    const answers = await ask("THREAD", q, { env: KEY_ENV, fetch: m.fetch });
    expect(answers.kind).toEqual({ choice: "sales", confidence: 0.9 });
    expect(m.calls[0].url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(m.calls[0].body).toEqual({ state: "THREAD", model: "typesafe/jev-1.13", questions: q });
    expect((m.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("needs the provider's key", async () => {
    await expect(ask("s", {}, { env: {}, fetch: mockFetch({ json: {} }).fetch })).rejects.toThrow(/OPENROUTER_API_KEY is not set/);
  });

  it("retries 429, 5xx and network errors, but not a 400", async () => {
    const ok = { json: { answers: { a: { noul: 0.5 } } } };
    const m = mockFetch({ status: 429, text: "slow down" }, { status: 503, text: "busy" }, new Error("socket hang up"), ok);
    expect(await ask("s", {}, { env: KEY_ENV, fetch: m.fetch, sleep: noSleep })).toEqual({ a: { noul: 0.5 } });
    expect(m.calls).toHaveLength(4);

    const bad = mockFetch({ status: 400, text: "bad question" }, ok);
    await expect(ask("s", {}, { env: KEY_ENV, fetch: bad.fetch, sleep: noSleep })).rejects.toThrow("jev 400: bad question");
    expect(bad.calls).toHaveLength(1);

    const down = mockFetch({ status: 500, text: "down" });
    await expect(ask("s", {}, { env: KEY_ENV, fetch: down.fetch, sleep: noSleep, maxAttempts: 2 })).rejects.toThrow("jev 500");
  });

  it("refuses a response without an answers map", async () => {
    const m = mockFetch({ json: { error: "x" } });
    await expect(ask("s", {}, { env: KEY_ENV, fetch: m.fetch })).rejects.toThrow(/no answers map/);
  });

  it("reads choice and noul answers", () => {
    const opts = ["sales", "personal"];
    expect(readChoice({ choice: "personal", confidence: 0.6, probabilities: { sales: 0.7, personal: 0.3 } }, opts)).toEqual({ choice: "sales", probability: 0.7 });
    expect(readChoice({ choice: "personal", confidence: 0.81 }, opts)).toEqual({ choice: "personal", probability: 0.81 });
    expect(readChoice({ choice: "other", confidence: 0.9 }, opts)).toBeNull();
    expect(readChoice(null, opts)).toBeNull();
    expect(readNoul({ type: "noul", noul: 0.98 })).toBe(0.98);
    expect(readNoul({ noul: "junk" })).toBeNull();
    expect(readNoul({ noul: 3 })).toBe(1);
  });
});

describe("triage backend selection", () => {
  it("OS_TRIAGE wins, else jev with a key, else llm; tests never default to the network", () => {
    expect(resolveTriageBackend({ OS_TRIAGE: "fake", OPENROUTER_API_KEY: "k" })).toBe("fake");
    expect(resolveTriageBackend({ OS_TRIAGE: "jev" })).toBe("jev");
    expect(resolveTriageBackend({ OPENROUTER_API_KEY: "k" })).toBe("jev");
    expect(resolveTriageBackend({})).toBe("llm");
    expect(resolveTriageBackend({ VITEST: "true", OPENROUTER_API_KEY: "k" })).toBe("llm");
  });

  it("reads OS_TRIAGE_JEV_MIN", () => {
    expect(jevMin({})).toBe(DEFAULT_JEV_MIN);
    expect(jevMin({ OS_TRIAGE_JEV_MIN: "0.8" })).toBe(0.8);
    expect(jevMin({ OS_TRIAGE_JEV_MIN: "nope" })).toBe(DEFAULT_JEV_MIN);
  });
});

// ---------------------------------------------------------------- triage on Jev
function store(contact: TriageContact, thread: ThreadMessage[]) {
  const saves: TriageUpdate[] = [];
  const s: TriageStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    save: async (_id, kind, u) => {
      if (kind !== contact.kind) return;
      saves.push(u);
      contact.triagedMessageId = u.triagedMessageId;
    },
  };
  return { s, saves };
}

const base = (kind: ContactKind, over: Partial<TriageContact> = {}): TriageContact => ({
  id: "c1",
  workspaceId: "w1",
  igUserId: "101",
  username: "sam",
  conversationId: "conv1",
  kind,
  tags: [],
  triagedMessageId: null,
  entryPath: null,
  ...over,
});
const msg = (id: string, text: string, incoming = true): ThreadMessage => ({ id, text, incoming, at: `2026-10-18T10:0${id.slice(1)}:00Z` });
const now = new Date("2026-10-18T11:00:00Z");
const choice = (sales: number) => ({ json: { answers: { kind: { type: "choice", choice: sales >= 0.5 ? "sales" : "personal", confidence: Math.max(sales, 1 - sales), probabilities: { sales, personal: 1 - sales } } } } });

describe("triageContact on Jev", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("suggests at or above the floor, with the probability and a rule-based hint", async () => {
    const m = mockFetch(choice(0.86));
    const c = base("UNSORTED", { entryPath: "story_reply" });
    const { s, saves } = store(c, [msg("m1", "hey, how much is your coaching?")]);
    const r = await triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } });
    expect(r).toEqual({ status: "suggested", kind: "SALES", reason: 'Jev 0.86 · sales · mentions "how much"', confidence: 0.86 });
    expect(saves[0]).toMatchObject({ suggestedKind: "SALES", suggestedConfidence: 0.86, kindSource: "triage", triagedMessageId: "m1" });
    const body = m.calls[0].body as { state: string; questions: Record<string, { type: string; criteria: Record<string, string> }> };
    expect(body.state).toContain("@sam");
    expect(body.state).toContain("came in via story reply");
    expect(body.state).toContain("THEM: hey, how much is your coaching?");
    expect(body.questions.kind.type).toBe("choice");
    expect(Object.keys(body.questions.kind.criteria)).toEqual(["sales", "personal"]);
  });

  it("below the floor: no suggestion, keeps the probability (J isn't sure)", async () => {
    const m = mockFetch(choice(0.58));
    const { s, saves } = store(base("UNSORTED"), [msg("m1", "nice post")]);
    const r = await triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } });
    expect(r).toMatchObject({ status: "unsure", lean: "SALES", confidence: 0.58 });
    expect(saves[0]).toMatchObject({ suggestedKind: null, suggestedConfidence: 0.58, suggestedReason: "Jev 0.58 · leans sales" });
    expect(saves[0].kindSource).toBeUndefined();
  });

  it("honours a custom floor and picks personal for a pitch", async () => {
    const m = mockFetch(choice(0.2));
    const { s, saves } = store(base("UNSORTED"), [msg("m1", "Hey! We help creators grow your page 10x, interested in a collab?")]);
    const r = await triageContact("c1", { store: s, now, backend: "jev", jevMin: 0.75, jev: { env: KEY_ENV, fetch: m.fetch } });
    expect(r).toMatchObject({ status: "suggested", kind: "PERSONAL", confidence: 0.8 });
    expect(saves[0].suggestedReason).toBe("Jev 0.80 · personal · reads like a pitch");
  });

  it("an unusable answer is skipped, not saved", async () => {
    const m = mockFetch({ json: { answers: { kind: { choice: "maybe" } } } });
    const { s, saves } = store(base("UNSORTED"), [msg("m1", "hi")]);
    expect(await triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } })).toMatchObject({ status: "skipped" });
    expect(saves).toHaveLength(0);
  });

  it("surfaces a Jev failure as a JevError", async () => {
    const m = mockFetch({ status: 401, text: "bad key" });
    const { s } = store(base("UNSORTED"), [msg("m1", "hi")]);
    await expect(triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } })).rejects.toThrow(JevError);
  });

  it("uses Jev by default through OS_TRIAGE and the global fetch", async () => {
    const m = mockFetch(choice(0.9));
    vi.stubGlobal("fetch", m.fetch);
    vi.stubEnv("OS_TRIAGE", "jev");
    vi.stubEnv("OPENROUTER_API_KEY", "env-key");
    const { s } = store(base("UNSORTED"), [msg("m1", "I run an agency, can you build this for me?")]);
    expect(await triageContact("c1", { store: s, now })).toMatchObject({ status: "suggested", kind: "SALES", confidence: 0.9 });
    expect((m.calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer env-key");
  });
});

describe("Personal → Move to Sales? on Jev", () => {
  const history = [msg("m1", "dinner sat?"), msg("m2", "yes", false)];
  const noul = (p: number) => ({ json: { answers: { sales_enquiry: { type: "noul", noul: p } } } });

  it("ordinary chat never calls Jev", async () => {
    const m = mockFetch(noul(0.99));
    const { s } = store(base("PERSONAL", { triagedMessageId: "m2" }), [...history, msg("m3", "haha see you at 7")]);
    expect(await triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } })).toEqual({ status: "clear" });
    expect(m.calls).toHaveLength(0);
  });

  it("flags a sales enquiry at or above the floor, asking one noul question about the NEW messages", async () => {
    const m = mockFetch(noul(0.92));
    const c = base("PERSONAL", { triagedMessageId: "m2" });
    const { s, saves } = store(c, [...history, msg("m3", "wait how much is your coaching program?")]);
    const r = await triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } });
    expect(r).toMatchObject({ status: "suggested", kind: "SALES", confidence: 0.92 });
    expect(saves[0]).toMatchObject({ suggestedKind: "SALES", suggestedConfidence: 0.92, triagedMessageId: "m3" });
    expect(saves[0].kindSource).toBeUndefined();
    const body = m.calls[0].body as { state: string; questions: Record<string, { type: string }> };
    expect(body.questions.sales_enquiry.type).toBe("noul");
    expect(body.state).toContain("NEW THEM: wait how much is your coaching program?");
    expect(body.state).not.toContain("NEW THEM: dinner");
  });

  it("stays clear below the floor", async () => {
    const m = mockFetch(noul(0.4));
    const { s, saves } = store(base("PERSONAL", { triagedMessageId: "m2" }), [...history, msg("m3", "my program at the gym is brutal")]);
    expect(await triageContact("c1", { store: s, now, backend: "jev", jev: { env: KEY_ENV, fetch: m.fetch } })).toEqual({ status: "clear" });
    expect(saves[0]).toEqual({ triagedAt: now, triagedMessageId: "m3", suggestedBy: "jev" });
  });
});

describe("triage copy", () => {
  it("round-trips the Jev reason line", () => {
    expect(jevReason(0.861, "sales")).toBe("Jev 0.86 · sales");
    expect(parseJevReason('Jev 0.86 · sales · mentions "price"')).toEqual({ lean: "sales", unsure: false, hint: 'mentions "price"' });
    expect(parseJevReason("Jev 0.58 · leans personal")).toEqual({ lean: "personal", unsure: true, hint: null });
    expect(parseJevReason("Asked about pricing")).toBeNull();
  });

  it("shows a quiet percentage for Jev, the LLM reason as-is, and J isn't sure", () => {
    expect(triageCopy({ flag: false, suggested: "SALES", confidence: 0.86, reason: "Jev 0.86 · sales" })).toEqual({ label: "Looks like sales", pct: "86%", detail: null });
    expect(triageCopy({ flag: true, suggested: "SALES", confidence: 0.9, reason: 'Jev 0.90 · sales · mentions "price"' })).toEqual({ label: "Move to Sales?", pct: "90%", detail: 'mentions "price"' });
    expect(triageCopy({ flag: false, suggested: "PERSONAL", confidence: null, reason: "Friends making plans" })).toEqual({ label: "Looks like personal", pct: null, detail: "Friends making plans" });
    expect(triageCopy({ flag: false, suggested: null, confidence: 0.58, reason: "Jev 0.58 · leans sales" })).toEqual({ label: "J isn't sure", pct: null, detail: "leans sales 58%" });
    expect(isUnsure({ kind: "UNSORTED", suggestedKind: null, suggestedConfidence: 0.58 })).toBe(true);
    expect(isUnsure({ kind: "UNSORTED", suggestedKind: null, suggestedConfidence: null })).toBe(false);
    expect(isUnsure({ kind: "PERSONAL", suggestedKind: null, suggestedConfidence: 0.5 })).toBe(false);
  });

  it("hints from rules only", () => {
    expect(triageHint(["what's your pricing?"], "sales")).toBe('mentions "pricing"');
    expect(triageHint(["lol"], "sales")).toBeNull();
    expect(triageHint(["we help brands with a sponsorship"], "personal")).toBe("reads like a pitch");
  });
});
