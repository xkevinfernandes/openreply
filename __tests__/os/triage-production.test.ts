import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: async () => "w1" }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

import { sortWithJ } from "../../app/(os)/os/inbox/actions";
import {
  clearSampleSuggestions,
  clearSampleSuggestionsOnce,
  resolveTriageBackend,
  TRIAGE_DISABLED_NOTICE,
  triageContact,
  type SampleCleanupDb,
  type TriageStore,
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
      expect(c.data).toMatchObject({ suggestedKind: null, suggestedReason: null, suggestedConfidence: null, triagedMessageId: null });
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
