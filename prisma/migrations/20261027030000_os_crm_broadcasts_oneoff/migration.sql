-- DM CRM slice 5: broadcasts become one-off records (factory/dm-crm/prd.md
-- "Migrating existing broadcasts"). Nothing new sends, nothing scheduled stops.
-- Preview first: scripts/os-crm-migrate-preview.ts.
--
-- * The weekly row (Follow-up Friday) stays, under its key, as a DRAFT: its
--   template as text bubbles, an empty link bubble, no date. Never started.
-- * Each existing run becomes its own broadcast, key <key>-<run date>, id
--   "bc_" || run id, Start = Window on the run date, bubbles = template + that
--   run's link, mode per person, status from the run (drafting → drafting,
--   review → in_review, scheduled → scheduled or sending if a message is sent,
--   done → sent), duplicatedFromId = the weekly row ("Earlier sends").
-- * Runs are re-pointed, not copied: message ids, statuses, times and queued
--   send jobs are untouched.
-- * windowDay, link, enabled and the audience tag's name go (the tag id stays).

CREATE OR REPLACE FUNCTION pg_temp.os_bubbles(tpl text, link text) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE((
      SELECT jsonb_agg(jsonb_build_object('type', 'text', 'text', l.line) ORDER BY l.ord)
      FROM (
        SELECT btrim(regexp_replace(x, '\{link\}', '', 'gi')) AS line, ord
        FROM regexp_split_to_table(COALESCE(tpl, ''), E'\n') WITH ORDINALITY s(x, ord)
      ) l
      WHERE l.line <> ''
    ), '[]'::jsonb)
    || jsonb_build_array(jsonb_build_object('type', 'link', 'url', NULLIF(btrim(COALESCE(link, '')), ''), 'resourceId', NULL))
$$;

CREATE TEMP TABLE os_weekly AS SELECT "id" FROM "Broadcast" WHERE "sendDate" IS NULL AND "duplicatedFromId" IS NULL;

-- 1. One broadcast per run.
INSERT INTO "Broadcast" ("id", "workspaceId", "key", "name", "audienceTag", "audienceTagId", "contactIds", "status", "startMode", "sendDate",
  "bubbles", "personaliseMode", "variations", "duplicatedFromId", "template", "followupTemplate", "followupDelayMin",
  "windowStart", "windowEnd", "timezone", "setterId", "createdAt", "updatedAt")
SELECT 'bc_' || r."id", b."workspaceId", b."key" || '-' || r."runDate", b."name", b."audienceTag", b."audienceTagId", ARRAY[]::text[],
  CASE r."status"
    WHEN 'drafting' THEN 'drafting'
    WHEN 'review' THEN 'in_review'
    WHEN 'scheduled' THEN CASE WHEN EXISTS (SELECT 1 FROM "BroadcastMessage" m WHERE m."runId" = r."id" AND m."status" = 'sent') THEN 'sending' ELSE 'scheduled' END
    WHEN 'done' THEN 'sent'
    ELSE 'drafting' END,
  'window', r."runDate", pg_temp.os_bubbles(b."template", COALESCE(r."link", b."link")), 'per_person', '[]'::jsonb, b."id",
  b."template", b."followupTemplate", b."followupDelayMin", b."windowStart", b."windowEnd", b."timezone", b."setterId", r."createdAt", CURRENT_TIMESTAMP
FROM "BroadcastRun" r
JOIN "Broadcast" b ON b."id" = r."broadcastId"
WHERE b."id" IN (SELECT "id" FROM os_weekly)
ON CONFLICT DO NOTHING;

-- 2. Re-point each run (and so its messages) at its own broadcast.
UPDATE "BroadcastRun" r SET "broadcastId" = 'bc_' || r."id"
WHERE r."broadcastId" IN (SELECT "id" FROM os_weekly)
  AND EXISTS (SELECT 1 FROM "Broadcast" nb WHERE nb."id" = 'bc_' || r."id");

-- 3. The weekly row is kept as a draft to duplicate from.
UPDATE "Broadcast" SET "status" = 'draft', "startMode" = 'window', "sendDate" = NULL,
  "bubbles" = pg_temp.os_bubbles("template", NULL)
WHERE "id" IN (SELECT "id" FROM os_weekly);

DROP TABLE os_weekly;
DROP FUNCTION pg_temp.os_bubbles(text, text);

-- 4. The weekly shape goes.
ALTER TABLE "Broadcast" DROP COLUMN "audienceTag",
DROP COLUMN "enabled",
DROP COLUMN "link",
DROP COLUMN "windowDay";
