-- One source of truth for CRM targets: each CustomField's kitField / ghlField.
-- The legacy per-provider OsIntegration.mapping.qualification is copied onto
-- the field with the same key when that field has no target yet, then the keys
-- a field now covers are dropped from the legacy mapping (a cleared field must
-- stop sending). Keys with no CustomField stay there: buildPayload still reads
-- them as a fallback. Idempotent: a second run changes nothing.

-- 1. Copy the legacy Kit target onto fields with none.
UPDATE "CustomField" f
SET "kitField" = left(btrim(i."mapping" -> 'qualification' ->> f."key"), 120), "updatedAt" = CURRENT_TIMESTAMP
FROM "OsIntegration" i
WHERE i."workspaceId" = f."workspaceId" AND i."provider" = 'kit'
  AND f."kitField" IS NULL AND f."key" NOT IN ('first_name', 'email')
  AND jsonb_typeof(i."mapping" -> 'qualification') = 'object'
  AND NULLIF(btrim(i."mapping" -> 'qualification' ->> f."key"), '') IS NOT NULL;

-- 2. Same for GoHighLevel.
UPDATE "CustomField" f
SET "ghlField" = left(btrim(i."mapping" -> 'qualification' ->> f."key"), 120), "updatedAt" = CURRENT_TIMESTAMP
FROM "OsIntegration" i
WHERE i."workspaceId" = f."workspaceId" AND i."provider" = 'ghl'
  AND f."ghlField" IS NULL AND f."key" NOT IN ('first_name', 'email')
  AND jsonb_typeof(i."mapping" -> 'qualification') = 'object'
  AND NULLIF(btrim(i."mapping" -> 'qualification' ->> f."key"), '') IS NOT NULL;

-- 3. Drop the legacy keys a field now carries a target for (per provider).
UPDATE "OsIntegration" i
SET "mapping" = jsonb_set(i."mapping", '{qualification}', COALESCE((
    SELECT jsonb_object_agg(e.k, e.v)
    FROM jsonb_each(i."mapping" -> 'qualification') AS e(k, v)
    WHERE NOT EXISTS (
      SELECT 1 FROM "CustomField" f
      WHERE f."workspaceId" = i."workspaceId" AND f."key" = e.k
        AND (CASE WHEN i."provider" = 'kit' THEN f."kitField" ELSE f."ghlField" END) IS NOT NULL
    )
  ), '{}'::jsonb)),
  "updatedAt" = CURRENT_TIMESTAMP
WHERE i."provider" IN ('kit', 'ghl')
  AND jsonb_typeof(i."mapping" -> 'qualification') = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_each(i."mapping" -> 'qualification') AS e(k, v)
    JOIN "CustomField" f ON f."workspaceId" = i."workspaceId" AND f."key" = e.k
    WHERE (CASE WHEN i."provider" = 'kit' THEN f."kitField" ELSE f."ghlField" END) IS NOT NULL
  );
