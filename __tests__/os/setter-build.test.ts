// New setter (interview → docs → save) and Setter chat (proposal → diff →
// apply → History), on the fake backend with an in-memory Prisma stand-in so
// the real doc save path (saveDocBody) runs.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown> & { id: string };
const db: Record<string, Row[]> = {};
let n = 0;
const id = () => `id${++n}`;
const pick = (r: Row, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => {
    if (k === "setterId_key") return r.setterId === (v as Row).setterId && r.key === (v as Row).key;
    return r[k] === v;
  });
const table = (name: string) => (db[name] ??= []);

function model(name: string) {
  return {
    findMany: async ({ where }: { where?: Record<string, unknown> } = {}) => table(name).filter((r) => pick(r, where)),
    findFirst: async ({ where }: { where?: Record<string, unknown> } = {}) => table(name).find((r) => pick(r, where)) ?? null,
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const { revisions, ...rest } = data as { revisions?: { create: Record<string, unknown> } };
      const row: Row = { id: id(), createdAt: new Date(Date.now() + n), updatedAt: new Date(), ...rest };
      table(name).push(row);
      if (revisions) table("setterDocRevision").push({ id: id(), docId: row.id, createdAt: new Date(Date.now() + n), ...revisions.create });
      return row;
    },
    update: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const row = table(name).find((r) => pick(r, where))!;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },
    deleteMany: async ({ where }: { where: Record<string, unknown> }) => {
      db[name] = table(name).filter((r) => !pick(r, where));
      return { count: 0 };
    },
    createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
      for (const d of data) table(name).push({ id: id(), ...d });
      return { count: data.length };
    },
  };
}

const prisma = {
  setter: model("setter"),
  resource: model("resource"),
  setterResource: model("setterResource"),
  setterChatMessage: model("setterChatMessage"),
  setterDocRevision: model("setterDocRevision"),
  setterDoc: {
    ...model("setterDoc"),
    upsert: async ({ where, create, update }: { where: Record<string, unknown>; create: Record<string, unknown>; update: Record<string, unknown> }) => {
      const row = table("setterDoc").find((r) => pick(r, where));
      if (row) return Object.assign(row, update, { updatedAt: new Date() });
      return model("setterDoc").create({ data: create });
    },
    findUnique: async ({ where }: { where: { id: string } }) => {
      const doc = table("setterDoc").find((r) => r.id === where.id);
      if (!doc) return null;
      const revs = table("setterDocRevision")
        .filter((r) => r.docId === doc.id)
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime());
      return { ...doc, revisions: revs.slice(0, 1) };
    },
  },
  $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
};

vi.mock("@/lib/db/client", () => ({ prisma }));

const { generateSetterDraft, funnelDefaults } = await import("@/lib/os/setter/interview/generate");
const { createSetterFromDraft, freeName, INTERVIEW_AUTHOR } = await import("@/lib/os/setter/interview/save");
const { runChat, parseChatReply } = await import("@/lib/os/setter/chat/assistant");
const { addChatMessage, applyChatEdit, discardChatEdit, CHAT_AUTHOR } = await import("@/lib/os/setter/chat/store");
const { applyEdit, lineDiff } = await import("@/lib/os/setter/chat/diff");
const { loadDocs, saveDocBody } = await import("@/lib/os/setter/knowledge/doc-store");
const { profilePartsFromDocs } = await import("@/lib/os/setter/knowledge/docs");
const { leadMagnetLines } = await import("@/lib/os/setter/interview/questions");

const FAKE = { backend: "fake" as const, models: {}, effort: {}, max_tokens: {}, timeout_seconds: 1 };
const WS = "ws1";

const answers = {
  name: "J",
  persona: "I'm Sam, I build AI agents for coaches. Ex-agency owner.",
  audience: "Coaches and course creators who want to automate their DMs",
  offers: "Agent Build - $3.5k - call\nStarter guide, doc",
  fit: "Owners doing 5k+/mo. Not: beginners with no offer",
  resources: "Free DM playbook https://example.com/playbook\nPrompt pack",
  booking: "https://cal.com/sam/intro",
  voice: "lowercase, short. say 'bet'. never say 'hustle'. no emojis",
};

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
});

async function seedJ() {
  const j = await prisma.setter.create({ data: { workspaceId: WS, name: "J", isDefault: true } });
  await saveDocBody(j.id, "system_prompt", "# System prompt\n\nI'm Kevin.\n\n## Voice\n\nshort.\n", "import");
  await saveDocBody(j.id, "offers", "# Offers\n\n## Case study\n\nStatus: open\nSold by: call\n", "import");
  return j;
}

describe("New setter: interview → docs (fake backend)", () => {
  it("writes all five docs J's parsers read back, plus the funnel", async () => {
    const d = await generateSetterDraft(answers, FAKE, "METHOD");
    expect(d.sample).toBe(true);
    expect(d.docs.system_prompt).toMatch(/^# System prompt\n\nI'm Sam/);
    expect(d.docs.system_prompt).toContain("## Voice");
    expect(d.docs.system_prompt).toContain("never say 'hustle'");
    const parts = profilePartsFromDocs(d.docs);
    expect(parts.offers?.map((o) => [o.name, o.price, o.sold_by])).toEqual([
      ["Agent Build", "$3.5k", "call"],
      ["Starter guide", undefined, "doc"],
    ]);
    expect(parts.sections?.booking_link).toBe("https://cal.com/sam/intro");
    expect(parts.sections?.icp).toContain("Coaches");
    expect(parts.objections?.length).toBeGreaterThan(0);
    expect(d.funnel.map((s) => s.key)).toEqual(funnelDefaults().map((s) => s.key));
    expect(d.funnel.find((s) => s.key === "qualify")?.guidance).toContain("A fit looks like: Owners doing 5k+/mo");
    expect(d.leadMagnets).toEqual([
      { name: "Free DM playbook", link: "https://example.com/playbook" },
      { name: "Prompt pack", link: null },
    ]);
  });

  it("the method never lands in a doc", async () => {
    const d = await generateSetterDraft(answers, FAKE, "SECRET METHOD TEXT");
    for (const body of Object.values(d.docs)) expect(body).not.toContain("SECRET METHOD");
  });

  it("saves as a NEW setter and never overwrites J", async () => {
    const j = await seedJ();
    const before = JSON.stringify({ j: db.setter.find((s) => s.id === j.id), docs: await loadDocs(j.id) });
    const d = await generateSetterDraft(answers, FAKE, "METHOD");
    const r = await createSetterFromDraft(WS, d);
    expect(r.name).toBe("J (2)");
    expect(r.setterId).not.toBe(j.id);
    expect(JSON.stringify({ j: db.setter.find((s) => s.id === j.id), docs: await loadDocs(j.id) })).toBe(before);
    const docs = await loadDocs(r.setterId);
    expect(Object.keys(docs).sort()).toEqual(["business", "examples", "objections", "offers", "system_prompt"]);
    expect(docs.system_prompt).toBe(d.docs.system_prompt);
    const revs = db.setterDocRevision.filter((v) => db.setterDoc.some((x) => x.id === v.docId && x.setterId === r.setterId));
    expect(revs).toHaveLength(5);
    expect(revs.every((v) => v.author === INTERVIEW_AUTHOR)).toBe(true);
    const created = db.setter.find((s) => s.id === r.setterId)!;
    expect(created.isDefault).toBe(false);
    expect((created.settings as { booking: { mode: string; link: string } }).booking).toMatchObject({ mode: "link", link: "https://cal.com/sam/intro" });
    expect(db.resource.map((x) => [x.name, x.status])).toEqual([
      ["Free DM playbook", "ACTIVE"],
      ["Prompt pack", "DRAFT"],
    ]);
    expect(db.setterResource.filter((x) => x.setterId === r.setterId)).toHaveLength(2);
  });

  it("reuses a workspace lead magnet with the same link", async () => {
    await prisma.resource.create({ data: { workspaceId: WS, slug: "playbook", name: "Playbook", link: "https://example.com/playbook", sortOrder: 3 } });
    const d = await generateSetterDraft(answers, FAKE, "METHOD");
    await createSetterFromDraft(WS, d);
    expect(db.resource).toHaveLength(2);
  });

  it("names and lines", () => {
    expect(freeName("J", ["J", "j (2)"])).toBe("J (3)");
    expect(freeName("  ", [])).toBe("New setter");
    expect(leadMagnetLines("- Guide: https://x.co/g.\n\n2. Pack")).toEqual([
      { name: "Guide", link: "https://x.co/g" },
      { name: "Pack", link: null },
    ]);
  });
});

describe("Setter chat: proposal → diff → apply (fake backend)", () => {
  it("proposes an Offers.md edit, applies it through History as 'Setter chat'", async () => {
    const j = await seedJ();
    const docs = await loadDocs(j.id);
    const answer = await runChat({ setterName: "J", docs, corrections: [], history: [], message: "add the 7-day sprint offer" }, FAKE, "METHOD");
    expect(answer.edits).toHaveLength(1);
    const e = answer.edits[0];
    expect(e.doc).toBe("offers");
    expect(lineDiff(e.before, e.after).every((l) => l.op === "add")).toBe(true);

    const msg = await addChatMessage(j.id, { role: "assistant", text: answer.reply, edits: answer.edits.map((x) => ({ ...x, status: "proposed" as const })) });
    const revsBefore = db.setterDocRevision.length;
    const r = await applyChatEdit(j.id, msg.id, e.id);
    expect(r.ok).toBe(true);
    const after = await loadDocs(j.id);
    expect(after.offers).toContain("## Case study");
    expect(after.offers).toContain("## 7-day sprint\n\nStatus: draft");
    expect(profilePartsFromDocs(after).offers?.map((o) => o.name)).toEqual(["Case study", "7-day sprint"]);
    expect(db.setterDocRevision.length).toBe(revsBefore + 1);
    expect(db.setterDocRevision[db.setterDocRevision.length - 1]).toMatchObject({ author: CHAT_AUTHOR, body: after.offers });
    expect(r.ok && r.edits[0].status).toBe("applied");
    expect(await applyChatEdit(j.id, msg.id, e.id)).toMatchObject({ ok: false, error: "Already applied." });
  });

  it("a voice rule goes under ## Voice in System prompt.md", async () => {
    const j = await seedJ();
    const docs = await loadDocs(j.id);
    const a = await runChat({ setterName: "J", docs, corrections: [], history: [], message: "stop asking about revenue so early" }, FAKE, "METHOD");
    expect(a.edits[0].doc).toBe("system_prompt");
    expect(applyEdit(docs.system_prompt!, a.edits[0])).toBe("# System prompt\n\nI'm Kevin.\n\n## Voice\n\n- stop asking about revenue so early.\n\nshort.\n");
  });

  it("asks for a sandbox run without editing", async () => {
    const a = await runChat({ setterName: "J", docs: {}, corrections: [], history: [], message: "test it with a cold lead" }, FAKE, "METHOD");
    expect(a.edits).toEqual([]);
    expect(a.test?.length).toBeGreaterThan(0);
  });

  it("a doc that changed under the edit goes stale instead of guessing", async () => {
    const j = await seedJ();
    const msg = await addChatMessage(j.id, {
      role: "assistant",
      text: "x",
      edits: [{ id: "e1", doc: "offers", before: "Status: open", after: "Status: closed", why: "", status: "proposed" }],
    });
    await saveDocBody(j.id, "offers", "# Offers\n\n## Case study\n\nStatus: draft\n", "kevin@x");
    const r = await applyChatEdit(j.id, msg.id, "e1");
    expect(r).toMatchObject({ ok: false, error: "The doc changed since. Ask again." });
    expect(!r.ok && r.edits?.[0].status).toBe("stale");
    expect((await loadDocs(j.id)).offers).toContain("Status: draft");
  });

  it("discard marks it and writes nothing", async () => {
    const j = await seedJ();
    const msg = await addChatMessage(j.id, { role: "assistant", text: "x", edits: [{ id: "e1", doc: "offers", before: "", after: "## X", why: "", status: "proposed" }] });
    const revs = db.setterDocRevision.length;
    expect((await discardChatEdit(j.id, msg.id, "e1"))?.[0].status).toBe("discarded");
    expect(db.setterDocRevision.length).toBe(revs);
  });

  it("drops model edits it can't apply, keeps tolerant matches", () => {
    const docs = { offers: "# Offers\n\n## A\n\nStatus: open   \nSold by: call\n" };
    const a = parseChatReply(
      {
        reply: "ok",
        edits: [
          { doc: "offers", before: "Status: open\nSold by: call", after: "Status: closed\nSold by: call", why: "close it" },
          { doc: "offers", before: "nope", after: "x" },
          { doc: "Nope.md", before: "", after: "x" },
          { doc: "Offers.md", before: "", after: "## B" },
        ],
        test: ["hey"],
      },
      docs
    );
    expect(a.edits.map((e) => e.after)).toEqual(["Status: closed\nSold by: call", "## B"]);
    expect(applyEdit(docs.offers, a.edits[0])).toBe("# Offers\n\n## A\n\nStatus: closed\nSold by: call\n");
    expect(a.test).toEqual(["hey"]);
  });
});
