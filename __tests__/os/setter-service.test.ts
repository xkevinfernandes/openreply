import { describe, expect, it } from "vitest";
import { resolveBackend } from "../../lib/os/setter/config";
import { draft, extractJson, resolveModel } from "../../lib/os/setter/drafter";
import { fileKnowledgeSource, fileSetter, loadCatalog, loadMethod } from "../../lib/os/setter/knowledge";
import { commentPathPlan } from "../../lib/os/setter/comment-path";
import { buildPrompt, systemPrompt } from "../../lib/os/setter/prompt";
import { entryBlock, flattenMessage, resolve } from "../../lib/os/setter/resources";
import { approveDraft, discardDraft, draftForContact, splitBubbles } from "../../lib/os/setter/service";
import { newRecord, type SetterRecord, type ThreadMessage } from "../../lib/os/setter/state";
import type { DraftView, NewDraft, SetterContact, SetterStore } from "../../lib/os/setter/store";

function memoryStore(contact: SetterContact, thread: ThreadMessage[]) {
  const states = new Map<string, SetterRecord>();
  const drafts = new Map<string, DraftView>();
  const sent: { text: string; humanAgent: boolean }[] = [];
  let seq = 0;
  const store: SetterStore = {
    getContact: async (id) => (id === contact.id ? contact : null),
    readThread: async () => thread,
    loadState: async (id) => states.get(id) ?? null,
    saveState: async (c, rec) => void states.set(c.id, rec),
    pendingDraft: async (id) => [...drafts.values()].find((d) => d.contactId === id && d.status === "PENDING") ?? null,
    createDraft: async (input: NewDraft) => {
      for (const d of drafts.values()) if (d.status === "PENDING") d.status = "DISCARDED";
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
    markSent: async (id, s) => void Object.assign(drafts.get(id)!, { status: "SENT", bubbles: s.bubbles, edited: s.edited }),
    releaseDraft: async (id) => void (drafts.get(id)!.status = "PENDING"),
    discardDraft: async (id) => {
      const d = drafts.get(id);
      if (d?.status !== "PENDING") return false;
      d.status = "DISCARDED";
      return true;
    },
    listPending: async () => [...drafts.values()].filter((d) => d.status === "PENDING"),
    send: async (_c, text, humanAgent) => void sent.push({ text, humanAgent }),
    setSetterStage: async () => {},
  };
  return { store, states, drafts, sent };
}

const contact: SetterContact = {
  id: "c1",
  workspaceId: "w1",
  igUserId: "101",
  username: "sam",
  conversationId: "conv1",
  kind: "SALES",
  paused: false,
  tags: [],
};
const now = new Date("2026-10-18T10:05:00Z");
const knowledge = fileKnowledgeSource();
const thread: ThreadMessage[] = [
  { id: "m1", text: "hey man love the content, how do you build these agents?", incoming: true, at: "2026-10-18T10:00:00Z" },
];

describe("drafter seam", () => {
  it("extracts the first JSON value, fences and prose included", () => {
    expect(extractJson('sure:\n```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('blah {"bubbles": ["x"]} trailing')).toEqual({ bubbles: ["x"] });
    expect(extractJson('[{"n": 1}, {"n": 2}]')).toEqual([{ n: 1 }, { n: 2 }]);
    expect(() => extractJson("no json here")).toThrow();
  });

  it("maps unknown model ids onto their family", () => {
    expect(resolveModel("claude-sonnet-5", "draft")).toBe("claude-sonnet-5");
    expect(resolveModel("opus", "draft")).toBe("claude-opus-5-5");
    expect(resolveModel("claude-haiku-4-5-20251001", "triage")).toBe("claude-haiku-4-5");
    expect(resolveModel(undefined, "draft")).toBe("claude-sonnet-5");
  });

  it("picks the backend from the environment", () => {
    expect(resolveBackend({ OS_DRAFTER: "claude_cli" } as unknown as NodeJS.ProcessEnv)).toBe("claude_cli");
    expect(resolveBackend({ ANTHROPIC_API_KEY: "k", NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe("anthropic_api");
    expect(resolveBackend({ NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).toBe("claude_cli");
    expect(resolveBackend({ NODE_ENV: "development", OS_MOCK: "1", OS_MOCK_DRAFTER: "fake" } as unknown as NodeJS.ProcessEnv)).toBe("fake");
    expect(resolveBackend({ NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toBe("fake");
  });

  it("the fake backend is deterministic per draft kind", async () => {
    const settings = { backend: "fake" as const, models: {}, effort: {}, max_tokens: {}, timeout_seconds: 5 };
    const r = await draft({ system: "", prompt: "DRAFT KIND: nudge", settings });
    expect((r.obj as { bubbles: string[] }).bubbles).toEqual(["no stress if not, just lmk if it was useful"]);
  });
});

describe("knowledge and prompt", () => {
  it("builds the system prompt from the bundled method + brand block", () => {
    const fs = fileSetter();
    const system = systemPrompt(loadMethod(), fs.profile, fs.offered, "2026-10-18");
    expect(system).toContain("DM Setter — claudepreneur");
    expect(system).toContain("## BRAND CONTEXT");
    expect(system).toContain("@claudepreneur");
    expect(system).not.toMatch(/^---\ntype: setter-method/);
  });

  it("tells J about the comment path and the held-back lead magnet", () => {
    const catalog = loadCatalog();
    const block = entryBlock("lm-workshop-setter", catalog.resources);
    expect(block).toContain("NOT sent yet");
    const rec: SetterRecord = {
      ...newRecord("conv1", "sam"),
      entry: { via: "setter_comment", slug: "lm-workshop-setter", keyword: null, at: "2026-10-18T10:00:00Z" },
    };
    const prompt = buildPrompt(rec, thread, { kind: "reply", anchor: "m1", human_agent: true }, catalog, now);
    expect(prompt).toContain("DRAFT KIND: reply");
    expect(prompt).toContain("HUMAN_AGENT");
    expect(prompt).toContain("THEM: hey man love the content");
  });

  it("flattens Zernio button DMs and resolves resources from links", () => {
    const text = flattenMessage({
      message: "",
      attachments: [{ type: "template", payload: { generic: { elements: [{ title: "here you go", buttons: [{ title: "watch", url: "https://youtu.be/shZi3aes5Rg" }] }] } } }],
      metadata: { postbackTitle: "send me the video" },
    });
    expect(text).toBe("here you go\n[button: watch -> https://youtu.be/shZi3aes5Rg]\n[they tapped: send me the video]");
    expect(resolve(text, loadCatalog().resources).map((r) => r.slug)).toContain("yt02");
  });

  it("builds the comment-path automation shapes", () => {
    const gate = commentPathPlan({ keyword: "GUIDE" });
    expect(gate.buttons).toEqual([]);
    expect(gate.excludeKeywords).toEqual(["emailed", "sent"]);
    const link = commentPathPlan({ keyword: "CLAUDE", buttonUrl: "https://x.io", story: true });
    expect(link.linkTracking).toBe(true);
    expect(link.commentReply).toBeNull();
    expect(link.alsoMatchInDms).toBe(false);
  });
});

describe("draftForContact", () => {
  it("drafts for a sales contact and returns the same draft for the same anchor", async () => {
    const { store, states } = memoryStore(contact, thread);
    const r = await draftForContact("c1", { store, knowledge, now });
    expect(r.status).toBe("drafted");
    if (r.status !== "drafted") return;
    expect(r.draft.bubbles.length).toBeGreaterThan(0);
    expect(r.draft.anchor).toBe("m1");
    expect(r.draft.flags).toContain("sample");
    expect(states.get("c1")?.state).toBe("in_conversation");
    const again = await draftForContact("c1", { store, knowledge, now });
    expect(again.status).toBe("existing");
  });

  it("only drafts for sales contacts that aren't paused (spec item 7)", async () => {
    expect((await draftForContact("c1", { store: memoryStore({ ...contact, kind: "PERSONAL" }, thread).store, knowledge, now })).status).toBe("skipped");
    expect((await draftForContact("c1", { store: memoryStore({ ...contact, paused: true }, thread).store, knowledge, now })).status).toBe("skipped");
    expect((await draftForContact("c1", { store: memoryStore({ ...contact, tags: ["friend"] }, thread).store, knowledge, now })).status).toBe("skipped");
  });

  it("holding is valid: a hold drafts nothing and remembers the anchor", async () => {
    const { store, states, drafts } = memoryStore(contact, [{ ...thread[0], text: "[fake:hold] ok" }]);
    const r = await draftForContact("c1", { store, knowledge, now });
    expect(r.status).toBe("held");
    expect(drafts.size).toBe(0);
    expect(states.get("c1")?.skipped_anchors).toContain("m1");
  });

  it("is idle when nothing is due, unless a person asks", async () => {
    const ours: ThreadMessage[] = [...thread, { id: "m2", text: "ha what are you building?", incoming: false, at: "2026-10-18T10:03:00Z" }];
    const { store } = memoryStore(contact, ours);
    expect((await draftForContact("c1", { store, knowledge, now })).status).toBe("idle");
    const forced = await draftForContact("c1", { store, knowledge, now, force: true });
    expect(forced.status).toBe("drafted");
    if (forced.status === "drafted") expect(forced.draft.kind).toBe("nudge");
  });
});

describe("approve / discard", () => {
  it("sends every bubble, logs an edit, and moves the state on", async () => {
    const { store, states, drafts, sent } = memoryStore(contact, thread);
    const r = await draftForContact("c1", { store, knowledge, now });
    if (r.status !== "drafted") throw new Error("expected a draft");
    const res = await approveDraft(r.draft.id, "w1", { store, now: () => now, gapMs: 0, editedText: "yo\n\nwhat are you building?" });
    expect(res.error).toBeUndefined();
    expect(sent.map((s) => s.text)).toEqual(["yo", "what are you building?"]);
    expect(drafts.get(r.draft.id)?.status).toBe("SENT");
    const rec = states.get("c1")!;
    expect(rec.our_last_at).toBe("2026-10-18T10:05:00Z");
    expect(rec.sends?.[0].edited).toBe(true);
    expect((await approveDraft(r.draft.id, "w1", { store, gapMs: 0 })).error).toBeTruthy(); // no double send
  });

  it("discard skips the anchor so J doesn't redraft it", async () => {
    const { store, states } = memoryStore(contact, thread);
    const r = await draftForContact("c1", { store, knowledge, now });
    if (r.status !== "drafted") throw new Error("expected a draft");
    expect(await discardDraft(r.draft.id, "w1", store)).toEqual({});
    expect(states.get("c1")?.skipped_anchors).toContain("m1");
    expect((await draftForContact("c1", { store, knowledge, now })).status).toBe("idle");
  });

  it("splits composer text into bubbles on blank lines", () => {
    expect(splitBubbles("a\n\n b \n\n\nc\nd")).toEqual(["a", "b", "c\nd"]);
  });
});

import { waitingDrafts } from "../../lib/os/setter/service";

describe("waitingDrafts", () => {
  it("keeps the newest per contact, Sales only (Pitches never count)", () => {
    const d = (id: string, contactId: string, createdAt: string) => ({ id, contactId, createdAt }) as never;
    const kinds = new Map([["a", "SALES"], ["b", "PITCHES"], ["c", "SALES"]]);
    const out = waitingDrafts([d("1", "a", "2026-10-19T09:00:00Z"), d("2", "a", "2026-10-19T10:00:00Z"), d("3", "b", "2026-10-19T11:00:00Z"), d("4", "c", "2026-10-19T08:00:00Z")], kinds);
    expect(out.map((x: { id: string }) => x.id)).toEqual(["2", "4"]);
  });
});
