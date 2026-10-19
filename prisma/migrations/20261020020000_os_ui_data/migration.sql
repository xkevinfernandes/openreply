-- DM OS UI redesign, data (docs/sp/dms/2026-10-19-dm-os-ui-plan.md section 2).
-- Idempotent: every insert skips rows that exist. Old columns (Contact.onFriday,
-- OsIntegration.mapping.qualification) stay as they are, read-only.

-- 1. Follow-up Friday list -> the tag the broadcast audience reads.
UPDATE "Contact"
SET "tags" = array_append("tags", 'follow-up-friday'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "onFriday" = true AND NOT ('follow-up-friday' = ANY("tags"));

-- 2. One Follow-up Friday broadcast per workspace (off until Kevin enables it).
INSERT INTO "Broadcast" ("id", "workspaceId", "key", "name", "audienceTag", "template", "followupDelayMin",
  "windowDay", "windowStart", "windowEnd", "timezone", "enabled", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w."id", 'follow-up-friday', 'Follow-up Friday', 'follow-up-friday',
  E'hey {first_name}, just put this out and thought of you\n\n{link}', 5, 5, '10:00', '15:00',
  'Europe/Luxembourg', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace" w
ON CONFLICT ("workspaceId", "key") DO NOTHING;

-- 3. Built-in fields per workspace.
INSERT INTO "CustomField" ("id", "workspaceId", "key", "label", "type", "builtIn", "sortOrder", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w."id", f.key, f.label, f.type::"CustomFieldType", true, f.ord, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace" w
CROSS JOIN (VALUES ('first_name', 'First name', 'TEXT', 0), ('email', 'Email', 'EMAIL', 1)) AS f(key, label, type, ord)
ON CONFLICT ("workspaceId", "key") DO NOTHING;

-- 4. The qualification keys (lib/os/integrations/mapping.ts QUALIFICATION_FIELDS)
--    become global fields, with each provider's mapped field carried over.
INSERT INTO "CustomField" ("id", "workspaceId", "key", "label", "type", "builtIn", "sortOrder", "ghlField", "kitField", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, w."id", q.key, q.label, q.type::"CustomFieldType", false, q.ord,
  NULLIF((SELECT i."mapping" -> 'qualification' ->> q.key FROM "OsIntegration" i WHERE i."workspaceId" = w."id" AND i."provider" = 'ghl'), ''),
  NULLIF((SELECT i."mapping" -> 'qualification' ->> q.key FROM "OsIntegration" i WHERE i."workspaceId" = w."id" AND i."provider" = 'kit'), ''),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Workspace" w
CROSS JOIN (VALUES
  ('their_goal', 'Their goal', 'TEXT', 10),
  ('their_challenge', 'Their challenge', 'TEXT', 11),
  ('in_the_way', 'What''s in the way', 'TEXT', 12),
  ('tried_before', 'What they''ve tried', 'TEXT', 13),
  ('niche', 'Niche', 'TEXT', 14),
  ('monthly_revenue', 'Monthly revenue', 'TEXT', 15),
  ('pain', 'Pain', 'LONG_TEXT', 16),
  ('is_owner', 'Runs the business', 'TEXT', 17),
  ('fit_score', 'Fit score (0-5)', 'NUMBER', 18)
) AS q(key, label, type, ord)
ON CONFLICT ("workspaceId", "key") DO NOTHING;
