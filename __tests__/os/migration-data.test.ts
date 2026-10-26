// The wave-0 migrations are SQL; these checks keep them in step with the code
// (qualification keys, the Friday tag, idempotency) without a database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_FRIDAY } from "@/lib/os/broadcasts/types";
import { BUILT_IN_FIELDS } from "@/lib/os/fields/types";
import { QUALIFICATION_FIELDS } from "@/lib/os/integrations/mapping";
import { OS_EVENT_KINDS } from "@/lib/os/events";
import { SEED_FIELDS, SEED_FUNNEL, seedEvents } from "../../scripts/os-seed-dev";

const dir = path.resolve(__dirname, "../../prisma/migrations");
const sql = (name: string) => readFileSync(path.join(dir, name, "migration.sql"), "utf8");

describe("20261020000000_os_kind_pitches", () => {
  it("only adds the enum value (Postgres can't use it in the same transaction)", () => {
    const body = sql("20261020000000_os_kind_pitches").replace(/--.*$/gm, "").trim();
    expect(body).toBe(`ALTER TYPE "ContactKind" ADD VALUE IF NOT EXISTS 'PITCHES';`);
  });
});

describe("20261020010000_os_ui_redesign", () => {
  const s = sql("20261020010000_os_ui_redesign");
  it("creates every wave-0 table and column", () => {
    for (const t of ["OsWorkspace", "CustomField", "SetterField", "ContactFieldValue", "CampaignResource", "MessageMedia", "OsEvent", "SetterDoc", "SetterDocRevision", "Broadcast", "BroadcastRun", "BroadcastMessage"]) {
      expect(s).toContain(`CREATE TABLE "${t}"`);
    }
    expect(s).toMatch(/ALTER TABLE "Contact" ADD COLUMN\s+"seenAt"/);
    expect(s).toMatch(/"heldAt" TIMESTAMP\(3\)/);
    expect(s).toContain(`CREATE UNIQUE INDEX "OsEvent_dedupeKey_key"`);
  });

  it("adds no foreign key to an upstream table", () => {
    const fks = [...s.matchAll(/REFERENCES "(\w+)"/g)].map((m) => m[1]);
    for (const t of fks) expect(["CustomField", "SetterDoc", "Broadcast", "BroadcastRun"]).toContain(t);
  });
});

describe("20261020020000_os_ui_data", () => {
  const s = sql("20261020020000_os_ui_data");
  it("every insert is idempotent and the tag update is guarded", () => {
    const inserts = s.match(/INSERT INTO/g) ?? [];
    const conflicts = s.match(/ON CONFLICT \("workspaceId", "key"\) DO NOTHING/g) ?? [];
    expect(inserts.length).toBe(3);
    expect(conflicts.length).toBe(inserts.length);
    expect(s).toMatch(/WHERE "onFriday" = true AND NOT \('follow-up-friday' = ANY\("tags"\)\)/);
  });

  it("uses the Follow-up Friday key and tag the code reads", () => {
    expect(s).toContain(`'${FOLLOW_UP_FRIDAY.key}', '${FOLLOW_UP_FRIDAY.name}', '${FOLLOW_UP_FRIDAY.tag}'`);
  });

  it("creates the built-ins and every qualification key with its label", () => {
    for (const f of BUILT_IN_FIELDS) expect(s).toContain(`('${f.key}', '${f.label}', '${f.type}'`);
    for (const f of QUALIFICATION_FIELDS) expect(s).toContain(`('${f.key}', '${f.label.replace(/'/g, "''")}'`);
    expect(s).toContain(`i."mapping" -> 'qualification' ->> q.key`);
  });

  it("does not touch the old columns", () => {
    expect(s).not.toMatch(/DROP|"onFriday" = false|SET "onFriday"/);
  });
});

describe("dev seed", () => {
  it("has the board's 9 fields with the two built-ins", () => {
    expect(SEED_FIELDS).toHaveLength(9);
    expect(SEED_FIELDS.filter((f) => f.builtIn).map((f) => f.key)).toEqual(BUILT_IN_FIELDS.map((f) => f.key));
  });

  it("gives Home 118/42/26/9/4/3/1 within the last 7 days", () => {
    expect(SEED_FUNNEL.map(([, n]) => n)).toEqual([118, 42, 26, 9, 4, 3, 1]);
    for (const [k] of SEED_FUNNEL) expect(OS_EVENT_KINDS).toContain(k);
    const now = new Date("2026-10-19T12:00:00Z");
    const ev = seedEvents("w", now, null);
    expect(ev).toHaveLength(203);
    expect(new Set(ev.map((e) => e.dedupeKey)).size).toBe(203);
    for (const e of ev) {
      expect(e.at!.getTime()).toBeLessThan(now.getTime());
      expect(now.getTime() - e.at!.getTime()).toBeLessThan(7 * 86400_000);
    }
  });
});

describe("20261026010000_os_field_targets", () => {
  const s = sql("20261026010000_os_field_targets");
  const body = s.replace(/--.*$/gm, "");
  it("copies the legacy target onto the field only when the field has none", () => {
    expect(body).toMatch(/SET "kitField" = left\(btrim\(i."mapping" -> 'qualification' ->> f."key"\), 120\)/);
    expect(body).toMatch(/SET "ghlField" = left\(btrim\(i."mapping" -> 'qualification' ->> f."key"\), 120\)/);
    expect(body).toContain(`f."kitField" IS NULL`);
    expect(body).toContain(`f."ghlField" IS NULL`);
    expect(body).toContain(`f."key" NOT IN ('first_name', 'email')`);
  });

  it("drops only the legacy keys a field now carries, keeping the rest as the fallback", () => {
    expect(body).toMatch(/jsonb_set\(i."mapping", '\{qualification\}'/);
    expect(body).toContain(`CASE WHEN i."provider" = 'kit' THEN f."kitField" ELSE f."ghlField" END) IS NOT NULL`);
    expect(body).not.toMatch(/DROP|DELETE/);
  });
});
