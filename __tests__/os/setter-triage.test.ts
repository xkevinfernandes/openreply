import { describe, expect, it } from "vitest";
import type { ContactKind } from "../../app/generated/prisma/enums";
import { draft } from "../../lib/os/setter/drafter";
import { getSetterConfig } from "../../lib/os/setter/config";
import type { ThreadMessage } from "../../lib/os/setter/state";
import {
  buildTriagePrompt,
  looksLikeSales,
  triageContact,
  type TriageContact,
  type TriageStore,
  type TriageUpdate,
} from "../../lib/os/setter/triage";

function store(contact: TriageContact, thread: ThreadMessage[]) {
  const saves: TriageUpdate[] = [];
  let reads = 0;
  const s: TriageStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => {
      reads++;
      return thread;
    },
    save: async (_id, kind, u) => {
      if (kind !== contact.kind) return;
      saves.push(u);
      contact.triagedMessageId = u.triagedMessageId;
    },
  };
  return { s, saves, reads: () => reads };
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
  ...over,
});

const msg = (id: string, text: string, incoming = true): ThreadMessage => ({ id, text, incoming, at: `2026-10-18T10:0${id.slice(1)}:00Z` });
const now = new Date("2026-10-18T11:00:00Z");

describe("triage prompt and fake backend", () => {
  it("marks new messages and talks to the triage job", async () => {
    const thread = [msg("m1", "dinner sat?"), msg("m2", "yes", false), msg("m3", "how much is your coaching")];
    const p = buildTriagePrompt(thread, "sam", "personal_check", 2);
    expect(p.startsWith("TRIAGE: kind")).toBe(true);
    expect(p).toContain("already marked PERSONAL");
    expect(p).toContain("NEW THEM: how much is your coaching");
    expect(p).not.toContain("NEW THEM: dinner");
    const r = await draft({ system: "s", prompt: p, job: "triage", settings: getSetterConfig().drafter });
    expect(r.usage.backend).toBe("fake");
    expect(r.obj).toMatchObject({ kind: "sales" });
  });

  it("flags offer questions, not ordinary chat", () => {
    expect(looksLikeSales(["how much is the program?"])).toBe(true);
    expect(looksLikeSales(["could you set this up for me"])).toBe(true);
    expect(looksLikeSales(["haha see you at 7"])).toBe(false);
  });
});

describe("triageContact on Unsorted", () => {
  it("stores a sales suggestion with a reason, kind stays Unsorted", async () => {
    const c = base("UNSORTED");
    const { s, saves } = store(c, [msg("m1", "I run a small agency, how do you automate your DMs? [fake:sales]")]);
    const r = await triageContact("c1", { store: s, now });
    expect(r).toMatchObject({ status: "suggested", kind: "SALES" });
    expect(saves[0]).toMatchObject({ suggestedKind: "SALES", kindSource: "triage", triagedMessageId: "m1" });
    expect(saves[0].suggestedReason).toBeTruthy();
    expect(c.kind).toBe("UNSORTED");
  });

  it("suggests personal for a friend", async () => {
    const { s, saves } = store(base("UNSORTED"), [msg("m1", "bro are we still on for saturday [fake:personal]")]);
    expect(await triageContact("c1", { store: s, now })).toMatchObject({ status: "suggested", kind: "PERSONAL" });
    expect(saves[0].suggestedKind).toBe("PERSONAL");
  });

  it("does not re-ask about the same message unless forced", async () => {
    const { s, saves } = store(base("UNSORTED", { triagedMessageId: "m1" }), [msg("m1", "hey [fake:sales]")]);
    expect(await triageContact("c1", { store: s, now })).toMatchObject({ status: "skipped" });
    expect(saves).toHaveLength(0);
    expect(await triageContact("c1", { store: s, now, force: true })).toMatchObject({ status: "suggested" });
  });

  it("waits when they haven't written yet, and never touches Sales", async () => {
    const quiet = store(base("UNSORTED"), [msg("m1", "hey, thanks for the follow", false)]);
    expect(await triageContact("c1", { store: quiet.s, now })).toMatchObject({ status: "skipped", reason: "Nothing from them yet." });
    expect(quiet.saves[0]).toMatchObject({ triagedMessageId: null });
    expect(quiet.saves[0].suggestedKind).toBeUndefined();

    const sales = store(base("SALES"), [msg("m1", "hi")]);
    expect(await triageContact("c1", { store: sales.s, now })).toMatchObject({ status: "skipped" });
    expect(sales.reads()).toBe(0);
  });
});

describe("Personal contact asking about the offer (move to Sales?)", () => {
  const history = [msg("m1", "how much did the flights cost you lol"), msg("m2", "too much", false)];

  it("ignores ordinary chat without a model call", async () => {
    const { s, saves } = store(base("PERSONAL", { triagedMessageId: "m2" }), [...history, msg("m3", "haha see you at 7")]);
    expect(await triageContact("c1", { store: s, now })).toEqual({ status: "clear" });
    expect(saves[0]).toEqual({ triagedAt: now, triagedMessageId: "m3", suggestedBy: "llm" });
  });

  it("flags a new offer question and keeps them Personal", async () => {
    const c = base("PERSONAL", { triagedMessageId: "m2" });
    const { s, saves } = store(c, [...history, msg("m3", "wait how much is your coaching program?")]);
    const r = await triageContact("c1", { store: s, now });
    expect(r).toMatchObject({ status: "suggested", kind: "SALES" });
    expect(saves[0]).toMatchObject({ suggestedKind: "SALES", triagedMessageId: "m3" });
    expect(saves[0].kindSource).toBeUndefined();
    expect(c.kind).toBe("PERSONAL");
  });

  it("only reads what is new: old history never raises the flag", async () => {
    // never checked before: only their latest turn counts ("cost" in m1 is old)
    const { s } = store(base("PERSONAL"), [...history, msg("m3", "you around tonight?")]);
    expect(await triageContact("c1", { store: s, now })).toEqual({ status: "clear" });
  });

  it("drops the flag when the model says it is just chat", async () => {
    const { s, saves } = store(base("PERSONAL", { triagedMessageId: "m2" }), [...history, msg("m3", "my program at the gym is brutal [fake:personal]")]);
    expect(await triageContact("c1", { store: s, now })).toEqual({ status: "clear" });
    expect(saves[0].suggestedKind).toBeUndefined();
  });

  it("does not write over a kind the user changed meanwhile", async () => {
    const c = base("PERSONAL", { triagedMessageId: "m2" });
    const { s, saves } = store(c, [...history, msg("m3", "how much is coaching")]);
    const save = s.save;
    s.save = async (id, kind, u) => {
      c.kind = "SALES"; // the user moved them while J was thinking
      return save(id, kind, u);
    };
    await triageContact("c1", { store: s, now });
    expect(saves).toHaveLength(0);
  });
});
