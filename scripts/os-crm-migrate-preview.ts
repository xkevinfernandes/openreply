// Dry run of the DM CRM data migrations (factory/dm-crm/prd.md: "run (and
// the output shown to Kevin) before the real run"). Runs every CRM migration
// not yet applied, inside one transaction, prints what they did, and rolls
// back. Nothing changes.
//
//   DATABASE_URL=postgresql://…/a_copy_of_prod npx tsx scripts/os-crm-migrate-preview.ts
//
// Prints: the managed tags with every merged variant and Kit name(s), the
// contacts whose tags change, each Follow-up Friday run split into its own
// broadcast (with status), each weekly row's `enabled` value before it goes,
// and a check that every scheduled/sent broadcast message keeps its id and time.
//
// Re-running the inbox back-fill once the deploy is live (slice 3 rollout):
//   DATABASE_URL=… npx tsx scripts/os-crm-migrate-preview.ts --rerun-inbox-backfill
// applies only 20261027010000_os_crm_inbox_backfill again, for real (it only
// moves values later).
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

const DIR = path.join(process.cwd(), "prisma", "migrations");
const CRM = /_os_crm_/;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("Set DATABASE_URL (a copy of production, never production itself).");
  const sql = new Client({ connectionString: url });
  await sql.connect();
  try {
    if (process.argv.includes("--rerun-inbox-backfill")) {
      const name = "20261027010000_os_crm_inbox_backfill";
      await sql.query("BEGIN");
      await sql.query(readFileSync(path.join(DIR, name, "migration.sql"), "utf8"));
      await sql.query("COMMIT");
      console.log(`Re-ran ${name}.`);
      return;
    }

    const applied = new Set((await sql.query(`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL`)).rows.map((r) => r.migration_name as string));
    const pending = readdirSync(DIR)
      .filter((d) => CRM.test(d) && !applied.has(d))
      .sort();
    if (!pending.length) {
      console.log("Every DM CRM migration is already applied here. Nothing to preview.");
      return;
    }
    console.log(`Previewing ${pending.join(", ")} (rolled back at the end)\n`);

    await sql.query("BEGIN");
    const hasBroadcast = pending.some((p) => p.includes("broadcasts_oneoff"));
    const weekly = hasBroadcast
      ? (await sql.query(`SELECT "id", "key", "name", "enabled", "audienceTag", "link" FROM "Broadcast"`)).rows
      : [];
    const msgsBefore = (await sql.query(`SELECT "id", "status", "scheduledAt", "sentAt" FROM "BroadcastMessage" WHERE "status" IN ('scheduled', 'sent') ORDER BY "id"`)).rows;
    const tagsBefore = new Map((await sql.query(`SELECT "id", "tags" FROM "Contact"`)).rows.map((r) => [r.id as string, (r.tags as string[]).join(", ")]));

    for (const p of pending) await sql.query(readFileSync(path.join(DIR, p, "migration.sql"), "utf8"));

    if (pending.some((p) => p.includes("tags_seed"))) {
      const tags = (
        await sql.query(`
          SELECT t."workspaceId", t."name", t."system", t."kitNames",
                 COALESCE(array_agg(a."name" ORDER BY a."name") FILTER (WHERE a."id" IS NOT NULL), '{}') AS merged,
                 (SELECT count(*) FROM "Contact" c WHERE c."workspaceId" = t."workspaceId" AND t."name" = ANY(c."tags"))::int AS contacts
          FROM "Tag" t LEFT JOIN "TagAlias" a ON a."tagId" = t."id"
          GROUP BY t."id" ORDER BY t."workspaceId", t."name"`)
      ).rows;
      console.log("Managed tags (name · contacts · Kit name(s) · merged variants)");
      for (const t of tags) {
        const merged = (t.merged as string[]).length ? `  ← merged: ${(t.merged as string[]).join(", ")}` : "";
        console.log(`  [${t.workspaceId}] ${t.name}${t.system ? " (system)" : ""} · ${t.contacts} · Kit: ${(t.kitNames as string[]).join(" | ")}${merged}`);
      }
      const changed = (await sql.query(`SELECT "id", "username", "tags" FROM "Contact"`)).rows.filter((r) => tagsBefore.get(r.id) !== (r.tags as string[]).join(", "));
      console.log(`\nContacts whose tags change: ${changed.length}`);
      for (const c of changed.slice(0, 50)) console.log(`  @${c.username ?? c.id}: ${tagsBefore.get(c.id)} → ${(c.tags as string[]).join(", ")}`);
      if (changed.length > 50) console.log(`  … and ${changed.length - 50} more`);
    }

    if (hasBroadcast) {
      console.log("\nBroadcasts");
      for (const w of weekly) console.log(`  ${w.key}: kept as a draft (enabled was ${w.enabled}; tag ${w.audienceTag}; last link ${w.link ?? "none"})`);
      const made = (await sql.query(`SELECT "key", "status", "sendDate", "bubbles" FROM "Broadcast" WHERE "duplicatedFromId" IS NOT NULL ORDER BY "key"`)).rows;
      for (const b of made) {
        const link = (b.bubbles as { type: string; url?: string | null }[]).find((x) => x.type === "link")?.url ?? "no link";
        console.log(`  + ${b.key}: ${b.status} on ${b.sendDate} (${link})`);
      }
      const msgsAfter = (await sql.query(`SELECT "id", "status", "scheduledAt", "sentAt" FROM "BroadcastMessage" WHERE "status" IN ('scheduled', 'sent') ORDER BY "id"`)).rows;
      const same = JSON.stringify(msgsBefore) === JSON.stringify(msgsAfter);
      console.log(`\nScheduled/sent messages: ${msgsBefore.length} before, ${msgsAfter.length} after, ids and times ${same ? "identical ✓" : "DIFFERENT ✗"}`);
      if (!same) process.exitCode = 1;
    }

    if (pending.some((p) => p.includes("inbox_backfill"))) {
      const r = (
        await sql.query(`SELECT count(*)::int AS n, count("lastInboundAt")::int AS inbound, count("lastPersonalSendAt")::int AS personal,
                                count(*) FILTER (WHERE "lastInboundAt" > "lastOpenedAt")::int AS unread FROM "Contact"`)
      ).rows[0];
      console.log(`\nInbox back-fill: ${r.n} contacts, ${r.inbound} with a last inbound, ${r.personal} with a personal send, ${r.unread} unread (should be 0)`);
    }
  } finally {
    await sql.query("ROLLBACK").catch(() => {});
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
