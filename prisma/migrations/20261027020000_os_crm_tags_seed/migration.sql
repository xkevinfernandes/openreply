-- DM CRM slice 2: today's free-text tags become the managed list
-- (factory/dm-crm/prd.md "Managed tags", "System tags are pinned", "Kit always
-- sees the same tag name"). Preview first: scripts/os-crm-migrate-preview.ts
-- runs this inside a transaction, prints every merge and rolls back.
--
-- * key = lower case, surrounding spaces gone, runs of spaces/_/- become one
--   "-" (lib/os/tags/key.ts tagKey). Names with the same key are one tag.
-- * System tags (read by name: J's freeze/skip rules, booked, not_now,
--   Follow-up Friday) are seeded in every workspace and always keep their name.
-- * Otherwise the merged name is the most used variant (ties: the lower-case
--   one, then alphabetical).
-- * Kit names: the variants already pushed to Kit (ContactSync.pushedTags,
--   prefix stripped), most pushed first; none pushed = the tag's name.
-- * Every other variant becomes an alias; contacts are rewritten to the merged
--   names (order kept, duplicates dropped). Contact.updatedAt is left alone
--   (the metrics back-fill dates old wins by it).
-- * Broadcast.audienceTagId is set from the audience tag's name.

CREATE OR REPLACE FUNCTION pg_temp.os_tag_key(v text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(btrim(regexp_replace(btrim(COALESCE(v, '')), '[[:space:]_-]+', '-', 'g'), '-'))
$$;

CREATE TEMP TABLE os_seed_ws AS
  SELECT "id" AS ws FROM "Workspace"
  UNION SELECT "workspaceId" FROM "Contact"
  UNION SELECT "workspaceId" FROM "Broadcast";

CREATE TEMP TABLE os_seed_sys AS
  SELECT * FROM (VALUES ('client'), ('friend'), ('agent_paused'), ('booked'), ('not_now'), ('not_now_auto'), ('follow-up-friday')) v(name);

CREATE TEMP TABLE os_seed_use AS
  SELECT ws, name, pg_temp.os_tag_key(name) AS key, sum(n)::int AS n
  FROM (
    SELECT c."workspaceId" AS ws, btrim(t) AS name, 1 AS n FROM "Contact" c CROSS JOIN LATERAL unnest(c."tags") t
    UNION ALL
    SELECT b."workspaceId", btrim(b."audienceTag"), 0 FROM "Broadcast" b
  ) u
  WHERE pg_temp.os_tag_key(name) <> ''
  GROUP BY 1, 2;

CREATE TEMP TABLE os_seed_kit AS
  SELECT s."workspaceId" AS ws, k.name, pg_temp.os_tag_key(k.name) AS key, count(*)::int AS n
  FROM "ContactSync" s
  LEFT JOIN "OsIntegration" i ON i."workspaceId" = s."workspaceId" AND i."provider" = 'kit'
  CROSS JOIN LATERAL (
    SELECT CASE
      WHEN COALESCE(i."mapping" ->> 'tagPrefix', '') <> '' AND left(p, length(i."mapping" ->> 'tagPrefix')) = i."mapping" ->> 'tagPrefix'
        THEN substr(p, length(i."mapping" ->> 'tagPrefix') + 1)
      ELSE p END AS name
    FROM unnest(s."pushedTags") p
  ) k
  WHERE s."provider" = 'kit' AND pg_temp.os_tag_key(k.name) <> ''
  GROUP BY 1, 2;

-- 1. System tags, every workspace.
INSERT INTO "Tag" ("id", "workspaceId", "name", "key", "color", "kitNames", "system", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w.ws, s.name, pg_temp.os_tag_key(s.name), 'gray', ARRAY[]::text[], true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM os_seed_ws w CROSS JOIN os_seed_sys s
ON CONFLICT DO NOTHING;

-- 2. Every other tag in use, merged by key.
INSERT INTO "Tag" ("id", "workspaceId", "name", "key", "color", "kitNames", "system", "createdAt", "updatedAt")
SELECT DISTINCT ON (u.ws, u.key) gen_random_uuid()::text, u.ws, u.name, u.key, 'gray', ARRAY[]::text[], false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM os_seed_use u
ORDER BY u.ws, u.key, u.n DESC, (u.name = lower(u.name)) DESC, u.name
ON CONFLICT DO NOTHING;

-- 3. Kit names: what Kit already has, most pushed first.
UPDATE "Tag" t SET "kitNames" = k.names
FROM (SELECT ws, key, array_agg(name ORDER BY n DESC, name) AS names FROM os_seed_kit GROUP BY 1, 2) k
WHERE t."workspaceId" = k.ws AND t."key" = k.key AND COALESCE(cardinality(t."kitNames"), 0) = 0;

UPDATE "Tag" SET "kitNames" = ARRAY["name"] WHERE COALESCE(cardinality("kitNames"), 0) = 0;

-- 4. Every variant that isn't the tag's name is an alias of it.
INSERT INTO "TagAlias" ("id", "workspaceId", "tagId", "name", "key", "createdAt")
SELECT gen_random_uuid()::text, t."workspaceId", t."id", v.name, v.key, CURRENT_TIMESTAMP
FROM (SELECT ws, name, key FROM os_seed_use UNION SELECT ws, name, key FROM os_seed_kit) v
JOIN "Tag" t ON t."workspaceId" = v.ws AND t."key" = v.key
WHERE v.name <> t."name"
ON CONFLICT DO NOTHING;

-- 5. Contacts carry the merged names.
UPDATE "Contact" c SET "tags" = r.tags
FROM (
  SELECT c2."id", array_agg(m.name ORDER BY m.ord) AS tags
  FROM "Contact" c2
  CROSS JOIN LATERAL (
    SELECT t."name", min(x.ord) AS ord
    FROM unnest(c2."tags") WITH ORDINALITY x(v, ord)
    JOIN "Tag" t ON t."workspaceId" = c2."workspaceId" AND t."key" = pg_temp.os_tag_key(x.v)
    GROUP BY t."name"
  ) m
  GROUP BY c2."id"
) r
WHERE r."id" = c."id" AND r.tags IS DISTINCT FROM c."tags";

-- 6. Broadcast audiences by tag id.
UPDATE "Broadcast" b SET "audienceTagId" = t."id"
FROM "Tag" t
WHERE t."workspaceId" = b."workspaceId" AND t."key" = pg_temp.os_tag_key(b."audienceTag") AND b."audienceTagId" IS NULL;

DROP TABLE os_seed_ws, os_seed_sys, os_seed_use, os_seed_kit;
DROP FUNCTION pg_temp.os_tag_key(text);
