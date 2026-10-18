import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: async () => "w1" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { sortWithJ } from "../../app/(os)/os/inbox/actions";
import {
  clearSampleSuggestions,
  clearSampleSuggestionsOnce,
  judgedByWeaker,
  resolveTriageBackend,
  storedBackend,
  TRIAGE_DISABLED_NOTICE,
  triageContact,
  type SampleCleanupDb,
  type TriageContact,
  type TriageStore,
  type TriageUpdate,
} from "../../lib/os/setter/triage";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("production never runs the fake triage", () => {
  it("is disabled in production without Jev or an Anthropic key", () => {
    expect(resolveTriageBackend({ NODE_ENV: "production" })).toBe("disabled");
    expect(resolveTriageBackend({ NODE_ENV: "production", OS_TRIAGE: "fake" })).toBe("disabled");
    expect(resolveTriageBackend({ NODE_ENV: "production", OS_TRIAGE: "llm" })).toBe("disabled");
    expect(resolveTriageBackend({ NODE_ENV: "production", OS_DRAFTER: "fake" })).toBe("disabled");
  });

  it("runs on a real backend in production", () => {
    expect(resolveTriageBackend({ NODE_ENV: "production", OPENROUTER_API_KEY: "k" })).toBe("jev");
    expect(resolveTriageBackend({ NODE_ENV: "production", ANTHROPIC_API_KEY: "k" })).toBe("llm");
    expect(resolveTriageBackend({ NODE_ENV: "production", OS_TRIAGE: "jev" })).toBe("jev");
  });

  it("keeps the fake for development and tests", () => {
    expect(resolveTriageBackend({ NODE_ENV: "development", OS_TRIAGE: "fake" })).toBe("fake");
    expect(resolveTriageBackend({ NODE_ENV: "development" })).toBe("llm");
  });

  it("triageContact writes nothing and reads no thread when disabled", async () => {
    const calls: string[] = [];
    const store: TriageStore = {
      getContact: async () => {
        calls.push("get");
        return null;
      },
      readThread: async () => {
        calls.push("read");
        return [];
      },
      save: async () => {
        calls.push("save");
      },
    };
    const r = await triageContact("c1", { store, backend: "disabled" });
    expect(r).toEqual({ status: "skipped", reason: TRIAGE_DISABLED_NOTICE });
    expect(calls).toEqual([]);
  });

  it("Sort with J explains instead of sorting", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OS_TRIAGE", "");
    vi.stubEnv("OS_DRAFTER", "");
    vi.stubEnv("OPENROUTER_API_KEY", "");
    vi.stubEnv("TYPESAFE_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const r = await sortWithJ();
    expect(r).toEqual({ notice: `${TRIAGE_DISABLED_NOTICE}.` });
  });
});

describe("sample suggestion cleanup", () => {
  function fakeDb() {
    const calls: { where: Record<string, unknown>; data: Record<string, unknown> }[] = [];
    const db: SampleCleanupDb = {
      contact: {
        updateMany: async (args) => {
          calls.push(args);
          return { count: args.where.kindSource === "triage" ? 30 : 7 };
        },
      },
    };
    return { db, calls };
  }

  it("clears (sample) suggestions in the workspace only, J's guesses losing their source", async () => {
    const { db, calls } = fakeDb();
    expect(await clearSampleSuggestions("w1", db)).toBe(37);
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.where).toMatchObject({ workspaceId: "w1", suggestedReason: { contains: "(sample)" } });
      expect(c.data).toMatchObject({ suggestedKind: null, suggestedReason: null, suggestedConfidence: null, suggestedBy: null, triagedAt: null, triagedMessageId: null });
    }
    expect(calls[0].where.kindSource).toBe("triage");
    expect(calls[0].data.kindSource).toBeNull();
    expect("kindSource" in calls[1].data).toBe(false);
  });

  it("runs once per workspace", async () => {
    const { db, calls } = fakeDb();
    expect(await clearSampleSuggestionsOnce("w-once", db)).toBe(37);
    expect(await clearSampleSuggestionsOnce("w-once", db)).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("a failure is logged, not thrown, and retried next load", async () => {
    let fail = true;
    const db: SampleCleanupDb = {
      contact: {
        updateMany: async () => {
          if (fail) throw new Error("db down");
          return { count: 1 };
        },
      },
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await clearSampleSuggestionsOnce("w-retry", db)).toBe(0);
    fail = false;
    expect(await clearSampleSuggestionsOnce("w-retry", db)).toBe(2);
  });
});

describe("manual sort re-judges weaker backends", () => {
  const thread = [
    { id: "m1", text: "hey! love your reels", incoming: true, at: "2026-10-18T10:00:00Z" },
    { id: "m2", text: "thanks! what are you working on?", incoming: false, at: "2026-10-18T10:01:00Z" },
    { id: "m3", text: "trying to grow my coaching business", incoming: true, at: "2026-10-18T10:02:00Z" },
  ];

  function unsorted(over: Partial<TriageContact>) {
    const contact: TriageContact = {
      id: "c1",
      workspaceId: "w1",
      igUserId: "1",
      username: "sam",
      conversationId: "conv",
      kind: "UNSORTED",
      tags: [],
      triagedMessageId: "m3",
      ...over,
    };
    const saves: TriageUpdate[] = [];
    const store: TriageStore = {
      getContact: async () => contact,
      readThread: async () => thread,
      save: async (_id, _kind, u) => {
        saves.push(u);
      },
    };
    return { store, saves };
  }

  it("reads the backend from suggestedBy, else from the reason line", () => {
    expect(storedBackend({ suggestedBy: "jev", suggestedReason: null })).toBe("jev");
    expect(storedBackend({ suggestedBy: null, suggestedReason: "Asks about the business (sample)" })).toBe("fake");
    expect(storedBackend({ suggestedBy: null, suggestedReason: "Jev 0.86 · sales · mentions \"coaching\"" })).toBe("jev");
    expect(storedBackend({ suggestedBy: null, suggestedReason: "Wants help with content" })).toBe("llm");
    expect(storedBackend({ suggestedBy: null, suggestedReason: null })).toBeNull();
  });

  it("fake and unknown are always weaker; a stronger verdict is kept", () => {
    expect(judgedByWeaker({ suggestedBy: "fake" }, "fake")).toBe(true);
    expect(judgedByWeaker({ suggestedBy: null, suggestedReason: null }, "jev")).toBe(true);
    expect(judgedByWeaker({ suggestedBy: "llm" }, "jev")).toBe(true);
    expect(judgedByWeaker({ suggestedBy: "jev" }, "jev")).toBe(false);
    expect(judgedByWeaker({ suggestedBy: "jev" }, "llm")).toBe(false);
  });

  it("a fake (sample) guess on the same message is re-judged on a manual sort, and tagged with the new backend", async () => {
    const { store, saves } = unsorted({ suggestedBy: "fake", suggestedReason: "Asks about the business (sample)" });
    const r = await triageContact("c1", { store, manual: true, backend: "fake", now: new Date() });
    expect(r.status).toBe("suggested");
    expect(saves[0]).toMatchObject({ suggestedBy: "fake", triagedMessageId: "m3" });
  });

  it("legacy rows (no suggestedBy) from the fake are re-judged too", async () => {
    const { store } = unsorted({ suggestedBy: null, suggestedReason: "Reads like a personal chat (sample)" });
    expect((await triageContact("c1", { store, manual: true, backend: "llm" })).status).toBe("suggested");
  });

  it("the same backend on the same message is still skipped, and non-manual runs never re-judge", async () => {
    const same = unsorted({ suggestedBy: "llm", suggestedReason: "Wants help" });
    expect(await triageContact("c1", { store: same.store, manual: true, backend: "llm" })).toEqual({
      status: "skipped",
      reason: "J already looked at this message.",
    });
    const auto = unsorted({ suggestedBy: "fake", suggestedReason: "x (sample)" });
    expect((await triageContact("c1", { store: auto.store, backend: "llm" })).status).toBe("skipped");
  });
});
