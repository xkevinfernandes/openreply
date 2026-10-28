/**
 * DM events → DataOS on a real Postgres: the sync's queries (cursor, the JSON
 * `saved` filter), its encrypted config, the skipped OsEvent and a workflow
 * TrackedLink with no automation. Runs under `npm run test:migrations`.
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

import { dbDmEvents, writeDmEventsConfig } from "@/lib/os/dataos/dm-events-db";
import { DM_EVENTS_PROVIDER, syncDmEvents, type DmEventsBody } from "@/lib/os/dataos/dm-events";
import { dbWorkflowStore } from "@/lib/os/workflows/db-store";

const schema = `dm_events_${randomBytes(4).toString("hex")}`;
let sql: Client;
const NOW = new Date("2026-10-28T12:00:00Z");
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe.skipIf(!DB)("DM events sync (real Postgres)", () => {
  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "0".repeat(64);
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
    state.db = new PrismaClient({ adapter: new PrismaPg({ connectionString: DB!, max: 4, options: `-c search_path="${schema}"` }, { schema }) });
    const graph = { version: 1, nodes: [{ id: "trigger", type: "trigger", position: { x: 0, y: 0 }, data: { kind: "comment", keywords: ["vault"] } }], edges: [] };
    await state.db.workflow.create({ data: { id: "wf1", workspaceId: "w1", name: "Script vault", draftGraph: graph, currentVersionId: "v1" } });
    await state.db.workflowVersion.create({ data: { id: "v1", workflowId: "wf1", number: 1, graph, keywords: ["vault"] } });
    await state.db.workflowRun.create({
      data: { id: "run1", workspaceId: "w1", workflowId: "wf1", versionId: "v1", instagramAccountId: "ig1", igUserId: "sam", contactId: "c1", trigger: { kind: "comment", postId: "trial1", originalPostId: "orig1", text: "VAULT @sam" } },
    });
    const ev = (id: string, kind: string, m: number, extra: Record<string, unknown> = {}) =>
      state.db.workflowRunEvent.create({ data: { id, workspaceId: "w1", workflowId: "wf1", versionId: "v1", runId: "run1", nodeId: "trigger", kind, at: ago(m), ...extra } });
    await ev("e1", "enter", 50);
    await ev("e2", "sent", 49);
    await ev("e3", "replied", 48, { nodeId: "ask", data: { saved: true, validate: "email" } });
    await ev("e4", "replied", 47, { nodeId: "ask" });
    await ev("e5", "leave", 46, { nodeId: "opener", port: "button:send" });
    await ev("e6", "end", 45, { nodeId: "end", data: { status: "completed", exit: "completed" } });
  }, 120_000);

  afterAll(async () => {
    await state.db?.$disconnect();
    if (!sql) return;
    await sql.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await sql.end();
  });

  it("off until configured; the config is stored encrypted, the contact secret kept across updates", async () => {
    expect(await dbDmEvents.configs()).toEqual([]);
    await writeDmEventsConfig("w1", { baseUrl: "https://dataos.test/", ingestKey: "dk_1" });
    const row = await state.db.osIntegration.findUniqueOrThrow({ where: { workspaceId_provider: { workspaceId: "w1", provider: DM_EVENTS_PROVIDER } } });
    expect(row.credentials).not.toContain("dk_1");
    const [a] = await dbDmEvents.configs();
    expect(a).toMatchObject({ workspaceId: "w1", baseUrl: "https://dataos.test", ingestKey: "dk_1" });
    await writeDmEventsConfig("w1", { baseUrl: "https://dataos.test", ingestKey: "dk_2" });
    const [b] = await dbDmEvents.configs();
    expect(b.ingestKey).toBe("dk_2");
    expect(b.contactSecret).toBe(a.contactSecret);
  });

  it("a skipped comment is one OsEvent per comment id", async () => {
    const skip = { workspaceId: "w1", workflowId: "wf1", contactId: "c1", commentId: "cm9", postId: "trial1", originalPostId: null, reason: "owned_by_automation", at: ago(40) };
    await dbWorkflowStore.skipped(skip);
    await dbWorkflowStore.skipped(skip);
    expect(await state.db.osEvent.count({ where: { kind: "workflow_skipped" } })).toBe(1);
  });

  it("a workflow link is a TrackedLink with no automation", async () => {
    const l = await state.db.trackedLink.create({ data: { workspaceId: "w1", slug: "wfslug1", destinationUrl: "https://kevin.link/vault", workflowId: "wf1", runId: "run1", nodeId: "link", resourceSlug: "vault" } });
    expect(l.automationId).toBeNull();
  });

  it("sends the mappable events once, then nothing new", async () => {
    const bodies: DmEventsBody[] = [];
    const fetch = (async (_u: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response("{}", { status: 200 });
    }) as unknown as typeof globalThis.fetch;
    await syncDmEvents({ db: dbDmEvents, fetch, now: () => NOW });
    const ids = bodies.flatMap((b) => b.events.map((e) => [e.id, e.kind]));
    // e2 (sent) and e4 (replied, nothing saved) are never read.
    expect(ids.slice(0, 4)).toEqual([
      ["e1", "entered"],
      ["e3", "optin"],
      ["e5", "button_clicked"],
      ["e6", "completed"],
    ]);
    expect(ids.at(-1)?.[1]).toBe("skipped");
    const row = await state.db.osIntegration.findUniqueOrThrow({ where: { workspaceId_provider: { workspaceId: "w1", provider: DM_EVENTS_PROVIDER } } });
    expect((row.settings as { cursor: { run: { id: string } } }).cursor.run.id).toBe("e6");
    bodies.length = 0;
    await syncDmEvents({ db: dbDmEvents, fetch, now: () => NOW });
    expect(bodies).toEqual([]);
  });
});
