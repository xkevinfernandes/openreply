/**
 * The stage writer and the managed-tag rules on a real Postgres (row locks,
 * transactions, array rewrites). Runs under `npm run test:migrations`
 * (TEST_MIGRATIONS_DB_URL); skipped by `npm test`.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "../../app/generated/prisma/client";

const DB = process.env.TEST_MIGRATIONS_DB_URL;
const DIR = path.join(__dirname, "..", "..", "prisma", "migrations");

const state = vi.hoisted(() => ({ db: undefined as unknown as import("../../app/generated/prisma/client").PrismaClient }));
vi.mock("@/lib/db/client", () => ({
  get prisma() {
    return state.db;
  },
  getPrisma: () => state.db,
}));
// Field sync is queued in Redis; nothing to push here.
vi.mock("@/lib/os/integrations/queue", () => ({ markDirty: async () => {}, fireContactEvent: async () => {} }));

import { writeStage } from "@/lib/os/stage-writer";
import { columnFor, funnelColumns } from "@/lib/os/funnel";
import { addTag } from "@/lib/os/fields/write";
import { createTag, deleteTag, ensureTag, listTags, renameTag, resolveTag } from "@/lib/os/tags/store";
import { clearWonData, setWonData, wonDataOf } from "@/lib/os/events";
import { stampSend } from "@/lib/os/send-stamp";
import { funnelView, loadFunnelContacts } from "@/lib/os/crm-funnel";

const schema = `crm_writers_${randomBytes(4).toString("hex")}`;
let sql: Client;

async function contact(id: string, data: Record<string, unknown> = {}) {
  await state.db.contact.create({ data: { id, workspaceId: "w1", instagramAccountId: "ig1", igUserId: id, ...data } });
}

describe.skipIf(!DB)("DM CRM writers (real Postgres)", () => {
  beforeAll(async () => {
    sql = new Client({ connectionString: DB });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const dirs = readdirSync(DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    for (const d of dirs) await sql.query(readFileSync(path.join(DIR, d, "migration.sql"), "utf8"));
    await sql.query(`INSERT INTO "User" ("id", "updatedAt") VALUES ('u1', now())`);
    await sql.query(`INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES ('w1', 'Kevin', 'u1', now())`);
    // The send stamp skips work without a database url; the client is mocked above.
    process.env.DATABASE_URL ??= DB;
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB!, max: 6, options: `-c search_path="${schema}"` }, { schema }) });
    await state.db.setter.create({ data: { id: "set1", workspaceId: "w1", name: "J", isDefault: true, settings: { tag_options: ["hot", "friday"] } } });
  }, 120_000);

  afterAll(async () => {
    await state.db?.$disconnect();
    if (!sql) return;
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  });

  describe("stage writer", () => {
    it("locks the row: a booking webhook and a manual move together leave stage and log consistent", async () => {
      const columns = funnelColumns(null);
      for (let i = 0; i < 6; i++) {
        const id = `race${i}`;
        await contact(id, { stage: "IN_CONVERSATION", setterStage: "qualify" });
        await state.db.booking.create({ data: { workspaceId: "w1", contactId: id, provider: "mock", eventTypeId: "e", start: new Date(), timezone: "UTC", email: "a@b.co" } });
        await Promise.all([
          writeStage({ workspaceId: "w1", contactId: id, cause: "booking", change: { type: "stage", stage: "CALL_BOOKED", setterStage: "booked" } }, { onStageChanged: null }),
          writeStage({ workspaceId: "w1", contactId: id, cause: "user", change: { type: "column", column: "won" } }, { onStageChanged: null }),
        ]);
        const c = await state.db.contact.findUniqueOrThrow({ where: { id } });
        const log = await state.db.contactStageLog.findMany({ where: { contactId: id }, orderBy: { at: "asc" } });
        // Whichever ran first, Kevin's Won holds and the log chains from column to column.
        expect(c.stage).toBe("WON");
        const applied = log.filter((r) => r.outcome === "applied");
        expect(applied.at(-1)?.toColumn).toBe(columnFor({ stage: c.stage, setterStage: c.setterStage, attendance: null }, columns));
        for (let k = 1; k < applied.length; k++) expect(applied[k].fromColumn).toBe(applied[k - 1].toColumn);
        expect(log.length).toBe(2);
      }
    }, 60_000);

    it("logs applied and refused rows with their cause, and the hook-free path writes the stage", async () => {
      await contact("s1", { stage: "IN_CONVERSATION", setterStage: "open" });
      expect((await writeStage({ workspaceId: "w1", contactId: "s1", cause: "user", change: { type: "column", column: "booked" } }, { onStageChanged: null })).status).toBe("refused");
      expect((await writeStage({ workspaceId: "w1", contactId: "s1", cause: "setter", change: { type: "setterStage", setterStage: "qualify" } }, { onStageChanged: null })).status).toBe("applied");
      const log = await state.db.contactStageLog.findMany({ where: { contactId: "s1" }, orderBy: { at: "asc" } });
      expect(log.map((r) => [r.cause, r.outcome, r.fromColumn, r.toColumn])).toEqual([
        ["user", "refused", "open", "booked"],
        ["setter", "applied", "open", "qualify"],
      ]);
      expect(log[0].setterId).toBe("set1");
    });

    it("leaving Won clears the won amount and offer; the won event stays", async () => {
      await contact("w", { stage: "IN_CONVERSATION", setterStage: "open" });
      await writeStage({ workspaceId: "w1", contactId: "w", cause: "user", change: { type: "column", column: "won" } }, { onStageChanged: null });
      await setWonData({ workspaceId: "w1", contactId: "w", offer: "Coaching", amount: 1200 });
      let ev = await state.db.osEvent.findUniqueOrThrow({ where: { dedupeKey: "won:w" } });
      expect(wonDataOf(ev.data)).toMatchObject({ offer: "Coaching", amount: 1200 });
      await writeStage({ workspaceId: "w1", contactId: "w", cause: "user", change: { type: "column", column: "lost" } }, { onStageChanged: null });
      ev = await state.db.osEvent.findUniqueOrThrow({ where: { dedupeKey: "won:w" } });
      expect(wonDataOf(ev.data)).toBeNull();
      expect(await clearWonData("w", state.db as never)).toBe(false);
    });
  });

  describe("managed tags", () => {
    it("a new workspace gets the system tags on first read; they can't be renamed or deleted", async () => {
      expect((await listTags("w1")).filter((t) => t.system)).toHaveLength(7);
      for (const name of ["client", "friend", "agent_paused", "booked", "not_now", "not_now_auto", "follow-up-friday"]) {
        const t = (await resolveTag("w1", name))!;
        expect(t.system).toBe(true);
        expect((await renameTag("w1", t.id, `${name}-x`)).ok).toBe(false);
        expect((await deleteTag("w1", t.id, { force: true })).ok).toBe(false);
      }
    });

    it("writing a variant lands on the managed tag and creates nothing", async () => {
      await contact("t1");
      const before = await state.db.tag.count({ where: { workspaceId: "w1" } });
      await addTag({ workspaceId: "w1", contactId: "t1", tag: "Not-Now", source: "j" });
      expect((await state.db.contact.findUniqueOrThrow({ where: { id: "t1" } })).tags).toEqual(["not_now"]);
      expect(await state.db.tag.count({ where: { workspaceId: "w1" } })).toBe(before);
    });

    it("rename rewrites contacts and the setters' tag options; the old name keeps landing on it", async () => {
      await contact("t2", { tags: ["hot", "x"] });
      const hot = (await ensureTag("w1", "hot"))!;
      const r = await renameTag("w1", hot.id, "warm lead");
      expect(r.ok).toBe(true);
      expect((await state.db.contact.findUniqueOrThrow({ where: { id: "t2" } })).tags).toEqual(["warm lead", "x"]);
      const setter = await state.db.setter.findUniqueOrThrow({ where: { id: "set1" } });
      expect((setter.settings as { tag_options: string[] }).tag_options).toEqual(["warm lead", "friday"]);
      // J writes the old name: it lands on the renamed tag, nothing new is made.
      await contact("t3");
      await addTag({ workspaceId: "w1", contactId: "t3", tag: "HOT", source: "j" });
      expect((await state.db.contact.findUniqueOrThrow({ where: { id: "t3" } })).tags).toEqual(["warm lead"]);
      expect(await state.db.tag.count({ where: { workspaceId: "w1", key: "hot" } })).toBe(0);
      // Kit keeps seeing the old name.
      expect((await resolveTag("w1", "warm lead"))!.kitNames).toEqual(["hot"]);
      // A live alias can't become a new tag.
      expect(await createTag("w1", { name: "Hot" })).toEqual({ ok: false, error: "This was the old name of warm lead." });
    });

    it("delete is refused while an unsent broadcast uses the tag, unless forced", async () => {
      const t = (await createTag("w1", { name: "vip", color: "blue" }));
      if (!t.ok) throw new Error(t.error);
      await state.db.broadcast.create({ data: { workspaceId: "w1", key: "vip-push", name: "VIP push", audienceTagId: t.tag.id } });
      await contact("t4", { tags: ["vip"] });
      const refused = await deleteTag("w1", t.tag.id);
      expect(refused).toMatchObject({ ok: false, error: "Used by VIP push." });
      expect((await deleteTag("w1", t.tag.id, { force: true })).ok).toBe(true);
      expect((await state.db.contact.findUniqueOrThrow({ where: { id: "t4" } })).tags).toEqual([]);
    });
  });

  describe("send stamps", () => {
    it("human: outbound, personal send and opened; automated: outbound only; never backwards", async () => {
      await contact("p1", { lastInboundAt: new Date("2026-10-20T10:00:00Z"), lastOpenedAt: new Date("2026-10-19T00:00:00Z") });
      await stampSend({ contactId: "p1", workspaceId: "w1" }, { human: false, at: new Date("2026-10-20T11:00:00Z") });
      let c = await state.db.contact.findUniqueOrThrow({ where: { id: "p1" } });
      expect(c.lastOutboundAt?.toISOString()).toBe("2026-10-20T11:00:00.000Z");
      expect(c.lastPersonalSendAt).toBeNull();
      expect(c.lastOpenedAt?.toISOString()).toBe("2026-10-19T00:00:00.000Z");
      await stampSend({ contactId: "p1", workspaceId: "w1" }, { human: true, at: new Date("2026-10-20T12:00:00Z") });
      c = await state.db.contact.findUniqueOrThrow({ where: { id: "p1" } });
      expect([c.lastOutboundAt, c.lastPersonalSendAt, c.lastOpenedAt, c.lastMessageAt].map((d) => d?.toISOString())).toEqual(Array(4).fill("2026-10-20T12:00:00.000Z"));
      await stampSend({ contactId: "p1" }, { human: true, at: new Date("2026-10-20T09:00:00Z") });
      c = await state.db.contact.findUniqueOrThrow({ where: { id: "p1" } });
      expect(c.lastOpenedAt?.toISOString()).toBe("2026-10-20T12:00:00.000Z");
    });

    it("keyword paths find the contact by account and Instagram user id, and stamp nothing without one", async () => {
      await state.db.instagramAccount.create({ data: { id: "acc1", workspaceId: "w1", instagramId: "IGBIZ", username: "kevin", accessToken: "x" } as never });
      await state.db.contact.create({ data: { id: "p2", workspaceId: "w1", instagramAccountId: "acc1", igUserId: "IGSID9" } });
      expect(await stampSend({ instagramId: "IGBIZ", igUserId: "IGSID9" }, { human: false })).toBe(1);
      expect((await state.db.contact.findUniqueOrThrow({ where: { id: "p2" } })).lastOutboundAt).not.toBeNull();
      expect(await stampSend({ instagramId: "IGBIZ", igUserId: "nobody" }, { human: false })).toBe(0);
    });
  });

  describe("funnel loader", () => {
    it("reads the cohort, events, stage log and won data into the shared funnel", async () => {
      await state.db.contact.create({ data: { id: "f1", workspaceId: "w1", instagramAccountId: "ig1", igUserId: "f1", kind: "SALES", stage: "WON", setterStage: "assure" } });
      await state.db.contact.create({ data: { id: "f2", workspaceId: "w1", instagramAccountId: "ig1", igUserId: "f2", kind: "PERSONAL" } });
      await state.db.osEvent.create({ data: { workspaceId: "w1", contactId: "f1", kind: "conversation_started", dedupeKey: "cs:f1" } });
      await setWonData({ workspaceId: "w1", contactId: "f1", offer: "Coaching", amount: 900 });
      const contacts = await loadFunnelContacts("w1", 30);
      expect(contacts.some((c) => c.id === "f2")).toBe(false);
      const f1 = contacts.find((c) => c.id === "f1")!;
      expect(f1).toMatchObject({ wonAmount: 900 });
      expect(f1.events.has("conversation_started")).toBe(true);
      const view = funnelView(contacts.filter((c) => c.id === "f1"), 30, new Date());
      expect(view.steps.at(-1)?.count).toBe(1);
      expect(view.revenue).toMatchObject({ fromCohort: 900, closedInPeriod: 900 });
    });
  });
});
