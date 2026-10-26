/**
 * The DM CRM data migrations on fixtures, against a real Postgres. Runs under
 * `npm run test:migrations` (scripts/test-migrations.sh sets
 * TEST_MIGRATIONS_DB_URL); skipped by `npm test`, which stays database-free.
 *
 * Builds the schema from prisma/migrations inside a throwaway Postgres schema:
 * everything before the CRM migrations, then fixtures as production has them,
 * then the CRM migrations, then checks what Kevin would see.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { Client, types } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DB = process.env.TEST_MIGRATIONS_DB_URL;
const DIR = path.join(__dirname, "..", "..", "prisma", "migrations");
const FIRST_CRM = "20261027000000_os_crm_schema";

const dirs = () =>
  readdirSync(DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
const sqlOf = (name: string) => readFileSync(path.join(DIR, name, "migration.sql"), "utf8");

// Prisma stores timestamp(3) without time zone in UTC: read it back as UTC.
types.setTypeParser(1114, (v: string) => new Date(v.replace(" ", "T") + "Z"));

const schema = `crm_mig_${randomBytes(4).toString("hex")}`;
let sql: Client;

const T = (s: string) => `2026-10-${s}`;
let before: { id: string; status: string; scheduledAt: Date | null; sentAt: Date | null }[] = [];

async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql.query(text, params)).rows as T[];
}

describe.skipIf(!DB)("DM CRM migrations (fixtures, real Postgres)", () => {
  beforeAll(async () => {
    sql = new Client({ connectionString: DB });
    await sql.connect();
    await sql.query(`CREATE SCHEMA "${schema}"`);
    await sql.query(`SET search_path TO "${schema}"`);
    const all = dirs();
    for (const d of all.filter((d) => d < FIRST_CRM)) await sql.query(sqlOf(d));

    // --- fixtures, the shape production has before the CRM migrations
    await sql.query(`INSERT INTO "User" ("id", "updatedAt") VALUES ('u1', now())`);
    await sql.query(`INSERT INTO "Workspace" ("id", "name", "ownerId", "updatedAt") VALUES ('w1', 'Kevin', 'u1', now()), ('w2', 'Other', 'u1', now())`);
    const contact = (id: string, ws: string, tags: string[], last: string | null) =>
      sql.query(
        `INSERT INTO "Contact" ("id", "workspaceId", "instagramAccountId", "igUserId", "tags", "lastMessageAt", "updatedAt") VALUES ($1, $2, 'ig1', $1, $3, $4, '2026-01-01')`,
        [id, ws, tags, last]
      );
    await contact("c1", "w1", ["Not-Now", "hot", "follow up friday"], T("10T10:00:00Z"));
    await contact("c2", "w1", ["not_now", "Hot", "HOT", " hot "], T("11T10:00:00Z"));
    await contact("c3", "w1", ["hot", "Lead Magnet"], T("12T10:00:00Z"));
    await contact("c4", "w1", [], null);
    await contact("c5", "w2", ["Lead_magnet"], null);
    await sql.query(
      `INSERT INTO "SetterState" ("id", "contactId", "workspaceId", "state", "record", "updatedAt") VALUES ('s1', 'c1', 'w1', 'in_conversation', $1, now())`,
      [JSON.stringify({ their_last_at: "2026-10-09T08:00:00+00:00", our_last_at: "2026-10-09T09:30:00+00:00" })]
    );
    const draft = (id: string, contactId: string, sentAt: string, flags: string[]) =>
      sql.query(
        `INSERT INTO "Draft" ("id", "workspaceId", "contactId", "kind", "anchor", "bubbles", "status", "flags", "sentAt") VALUES ($1, 'w1', $2, 'reply', $1, '{}', 'SENT', $3, $4)`,
        [id, contactId, flags, sentAt]
      );
    await draft("d1", "c3", T("05T10:00:00Z"), []);
    await draft("d2", "c3", T("06T10:00:00Z"), ["autopilot"]);
    await draft("d3", "c4", T("07T10:00:00Z"), []);
    await sql.query(`INSERT INTO "OsEvent" ("id", "workspaceId", "contactId", "kind", "dedupeKey") VALUES ('e1', 'w1', 'c4', 'autopilot_sent', 'autopilot_sent:d3')`);
    // Kit already has: Not-Now twice, not_now once, hot once.
    const sync = (id: string, contactId: string, pushed: string[]) =>
      sql.query(`INSERT INTO "ContactSync" ("id", "workspaceId", "contactId", "provider", "pushedTags", "updatedAt") VALUES ($1, 'w1', $2, 'kit', $3, now())`, [id, contactId, pushed]);
    await sync("k1", "c1", ["Not-Now", "hot"]);
    await sync("k2", "c2", ["Not-Now", "not_now"]);
    // Follow-up Friday: the weekly row and two runs (one sent, one mid-send).
    await sql.query(
      `INSERT INTO "Broadcast" ("id", "workspaceId", "key", "name", "audienceTag", "link", "template", "windowDay", "windowStart", "windowEnd", "timezone", "setterId", "enabled", "updatedAt")
       VALUES ('b1', 'w1', 'follow-up-friday', 'Follow-up Friday', 'follow-up-friday', 'https://x.co/b', E'hey {first_name}, made this\n\n{link}', 5, '10:00', '15:00', 'Europe/Luxembourg', 'set1', true, now())`
    );
    await sql.query(`INSERT INTO "BroadcastRun" ("id", "broadcastId", "runDate", "link", "status") VALUES ('r1', 'b1', '2026-10-16', 'https://x.co/a', 'done'), ('r2', 'b1', '2026-10-23', 'https://x.co/b', 'scheduled'), ('r3', 'b1', '2026-10-30', 'https://x.co/c', 'review')`);
    const msg = (id: string, runId: string, contactId: string, status: string, scheduledAt: string | null, sentAt: string | null) =>
      sql.query(
        `INSERT INTO "BroadcastMessage" ("id", "runId", "workspaceId", "contactId", "bubbles", "followupBubbles", "status", "scheduledAt", "sentAt") VALUES ($1, $2, 'w1', $3, '{hi}', '{}', $4, $5, $6)`,
        [id, runId, contactId, status, scheduledAt, sentAt]
      );
    await msg("m1", "r1", "c1", "sent", T("16T10:10:00Z"), T("16T10:10:02Z"));
    await msg("m2", "r1", "c2", "skipped", null, null);
    await msg("m3", "r2", "c1", "sent", T("23T10:05:00Z"), T("23T10:05:01Z"));
    await msg("m4", "r2", "c2", "scheduled", T("23T13:40:00Z"), null);
    await msg("m5", "r3", "c3", "drafted", null, null);
    before = await q(`SELECT "id", "status", "scheduledAt", "sentAt" FROM "BroadcastMessage" ORDER BY "id"`);

    for (const d of all.filter((d) => d >= FIRST_CRM)) await sql.query(sqlOf(d));
  }, 120_000);

  afterAll(async () => {
    if (!sql) return;
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  });

  describe("inbox back-fill", () => {
    it("takes inbound/outbound from the setter record, else both from the last message", async () => {
      const rows = await q<{ id: string; lastInboundAt: Date | null; lastOutboundAt: Date | null; lastOpenedAt: Date | null }>(
        `SELECT "id", "lastInboundAt", "lastOutboundAt", "lastOpenedAt" FROM "Contact" ORDER BY "id"`
      );
      const by = new Map(rows.map((r) => [r.id, r]));
      expect(by.get("c1")!.lastInboundAt!.toISOString()).toBe("2026-10-09T08:00:00.000Z");
      expect(by.get("c1")!.lastOutboundAt!.toISOString()).toBe("2026-10-09T09:30:00.000Z");
      expect(by.get("c2")!.lastInboundAt!.toISOString()).toBe("2026-10-11T10:00:00.000Z");
      expect(by.get("c2")!.lastOutboundAt!.toISOString()).toBe("2026-10-11T10:00:00.000Z");
      expect(by.get("c4")!.lastInboundAt).toBeNull();
    });

    it("every existing thread starts read; a later inbound makes it unread", async () => {
      const rows = await q<{ id: string; unread: boolean }>(
        `SELECT "id", ("lastInboundAt" IS NOT NULL AND "lastInboundAt" > "lastOpenedAt") AS unread FROM "Contact"`
      );
      expect(rows.every((r) => !r.unread)).toBe(true);
      await sql.query(`UPDATE "Contact" SET "lastInboundAt" = now() + interval '1 minute' WHERE "id" = 'c2'`);
      const [c2] = await q<{ unread: boolean }>(`SELECT ("lastInboundAt" > "lastOpenedAt") AS unread FROM "Contact" WHERE "id" = 'c2'`);
      expect(c2.unread).toBe(true);
    });

    it("last personal send comes from Kevin-approved drafts only, never autopilot", async () => {
      const rows = await q<{ id: string; at: Date | null }>(`SELECT "id", "lastPersonalSendAt" AS at FROM "Contact" WHERE "id" IN ('c3', 'c4') ORDER BY "id"`);
      expect(rows[0].at!.toISOString()).toBe("2026-10-05T10:00:00.000Z");
      expect(rows[1].at).toBeNull();
    });

    it("is re-runnable and only moves values later", async () => {
      await sql.query(`UPDATE "Contact" SET "lastInboundAt" = '2026-10-20T00:00:00Z' WHERE "id" = 'c1'`);
      await sql.query(sqlOf("20261027010000_os_crm_inbox_backfill"));
      const [c1] = await q<{ at: Date }>(`SELECT "lastInboundAt" AS at FROM "Contact" WHERE "id" = 'c1'`);
      expect(c1.at.toISOString()).toBe("2026-10-20T00:00:00.000Z");
    });
  });

  describe("managed tags seed", () => {
    it("seeds the system tags in every workspace and merges variants by key", async () => {
      const tags = await q<{ workspaceId: string; name: string; key: string; system: boolean; kitNames: string[] }>(
        `SELECT "workspaceId", "name", "key", "system", "kitNames" FROM "Tag" ORDER BY "workspaceId", "name"`
      );
      const w1 = tags.filter((t) => t.workspaceId === "w1");
      expect(w1.map((t) => t.name).sort()).toEqual(
        ["agent_paused", "booked", "client", "follow-up-friday", "friend", "hot", "Lead Magnet", "not_now", "not_now_auto"].sort()
      );
      expect(w1.filter((t) => t.system).map((t) => t.name).sort()).toEqual(["agent_paused", "booked", "client", "follow-up-friday", "friend", "not_now", "not_now_auto"]);
      // w2 has its own list: the system tags plus its own variant.
      expect(tags.filter((t) => t.workspaceId === "w2").map((t) => t.name)).toContain("Lead_magnet");
    });

    it("the system name wins a merge; Kit names keep what Kit has, most pushed first", async () => {
      const [notNow] = await q<{ name: string; kitNames: string[] }>(`SELECT "name", "kitNames" FROM "Tag" WHERE "workspaceId" = 'w1' AND "key" = 'not-now'`);
      expect(notNow).toEqual({ name: "not_now", kitNames: ["Not-Now", "not_now"] });
      const [hot] = await q<{ kitNames: string[] }>(`SELECT "kitNames" FROM "Tag" WHERE "workspaceId" = 'w1' AND "key" = 'hot'`);
      expect(hot.kitNames).toEqual(["hot"]);
      const [lm] = await q<{ kitNames: string[] }>(`SELECT "kitNames" FROM "Tag" WHERE "workspaceId" = 'w1' AND "key" = 'lead-magnet'`);
      expect(lm.kitNames).toEqual(["Lead Magnet"]);
    });

    it("lists every merged variant as an alias", async () => {
      const aliases = await q<{ name: string; tag: string }>(
        `SELECT a."name", t."name" AS tag FROM "TagAlias" a JOIN "Tag" t ON t."id" = a."tagId" WHERE a."workspaceId" = 'w1' ORDER BY a."name"`
      );
      expect(aliases).toEqual([
        { name: "follow up friday", tag: "follow-up-friday" },
        { name: "Hot", tag: "hot" },
        { name: "HOT", tag: "hot" },
        { name: "Not-Now", tag: "not_now" },
      ].sort((a, b) => (a.name < b.name ? -1 : 1)));
    });

    it("rewrites contacts to the merged names, order kept, duplicates gone, updatedAt untouched", async () => {
      const rows = await q<{ id: string; tags: string[]; updatedAt: Date }>(`SELECT "id", "tags", "updatedAt" FROM "Contact" ORDER BY "id"`);
      const by = new Map(rows.map((r) => [r.id, r]));
      expect(by.get("c1")!.tags).toEqual(["not_now", "hot", "follow-up-friday"]);
      expect(by.get("c2")!.tags).toEqual(["not_now", "hot"]);
      expect(by.get("c3")!.tags).toEqual(["hot", "Lead Magnet"]);
      expect(by.get("c4")!.tags).toEqual([]);
      expect(by.get("c1")!.updatedAt.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    });
  });

  describe("broadcasts become one-offs", () => {
    it("keeps the weekly row as a draft with its template and an empty link bubble", async () => {
      const [b] = await q<Record<string, unknown>>(`SELECT * FROM "Broadcast" WHERE "key" = 'follow-up-friday'`);
      expect(b.status).toBe("draft");
      expect(b.sendDate).toBeNull();
      expect(b.setterId).toBe("set1");
      expect(b.bubbles).toEqual([
        { type: "text", text: "hey {first_name}, made this" },
        { type: "link", url: null, resourceId: null },
      ]);
      const [tag] = await q<{ id: string }>(`SELECT "id" FROM "Tag" WHERE "workspaceId" = 'w1' AND "name" = 'follow-up-friday'`);
      expect(b.audienceTagId).toBe(tag.id);
      for (const gone of ["windowDay", "link", "enabled", "audienceTag"]) expect(b).not.toHaveProperty(gone);
    });

    it("makes one broadcast per run, with the run's link, date and status", async () => {
      const rows = await q<{ id: string; key: string; status: string; sendDate: string; bubbles: unknown[]; duplicatedFromId: string; setterId: string; timezone: string }>(
        `SELECT "id", "key", "status", "sendDate", "bubbles", "duplicatedFromId", "setterId", "timezone" FROM "Broadcast" WHERE "key" <> 'follow-up-friday' ORDER BY "key"`
      );
      expect(rows.map((r) => [r.key, r.status, r.sendDate])).toEqual([
        ["follow-up-friday-2026-10-16", "sent", "2026-10-16"],
        ["follow-up-friday-2026-10-23", "sending", "2026-10-23"],
        ["follow-up-friday-2026-10-30", "in_review", "2026-10-30"],
      ]);
      expect(rows[0].bubbles.at(-1)).toEqual({ type: "link", url: "https://x.co/a", resourceId: null });
      for (const r of rows) {
        expect(r.duplicatedFromId).toBe("b1");
        expect(r.setterId).toBe("set1");
        expect(r.timezone).toBe("Europe/Luxembourg");
      }
      const runs = await q<{ id: string; broadcastId: string }>(`SELECT "id", "broadcastId" FROM "BroadcastRun" ORDER BY "id"`);
      expect(runs).toEqual([
        { id: "r1", broadcastId: "bc_r1" },
        { id: "r2", broadcastId: "bc_r2" },
        { id: "r3", broadcastId: "bc_r3" },
      ]);
    });

    it("leaves every message id, status and time exactly as it was", async () => {
      const after = await q(`SELECT "id", "status", "scheduledAt", "sentAt" FROM "BroadcastMessage" ORDER BY "id"`);
      expect(after).toEqual(before);
    });
  });
});
