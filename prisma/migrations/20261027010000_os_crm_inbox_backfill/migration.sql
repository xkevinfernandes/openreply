-- DM CRM slice 3 back-fill (factory/dm-crm/prd.md "Unread needs new storage").
-- Forward-only and re-runnable (scripts/os-crm-backfill-inbox.ts runs the same
-- SQL again once the deploy is live): a value only ever moves later.
--
-- * last inbound / outbound: the setter record's their_last_at / our_last_at,
--   else both from the stored last-message time (equal = "they didn't write last").
-- * last opened = now: every existing thread starts read.
-- * last personal send: J drafts Kevin approved and sent, never autopilot ones.

CREATE OR REPLACE FUNCTION pg_temp.os_ts(v text) RETURNS timestamp(3) LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF v IS NULL OR v = '' THEN RETURN NULL; END IF;
  RETURN (v::timestamptz AT TIME ZONE 'UTC')::timestamp(3);
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;

UPDATE "Contact" c
SET "lastInboundAt" = GREATEST(c."lastInboundAt", src.inbound),
    "lastOutboundAt" = GREATEST(c."lastOutboundAt", src.outbound)
FROM (
  SELECT c2."id",
    COALESCE(pg_temp.os_ts(s."record" ->> 'their_last_at'), CASE WHEN s."id" IS NULL OR pg_temp.os_ts(s."record" ->> 'our_last_at') IS NULL THEN c2."lastMessageAt" END) AS inbound,
    COALESCE(pg_temp.os_ts(s."record" ->> 'our_last_at'), CASE WHEN s."id" IS NULL OR pg_temp.os_ts(s."record" ->> 'their_last_at') IS NULL THEN c2."lastMessageAt" END) AS outbound
  FROM "Contact" c2
  LEFT JOIN "SetterState" s ON s."contactId" = c2."id"
) src
WHERE src."id" = c."id"
  AND (src.inbound IS NOT NULL OR src.outbound IS NOT NULL)
  AND (c."lastInboundAt" IS DISTINCT FROM GREATEST(c."lastInboundAt", src.inbound)
    OR c."lastOutboundAt" IS DISTINCT FROM GREATEST(c."lastOutboundAt", src.outbound));

UPDATE "Contact" SET "lastOpenedAt" = CURRENT_TIMESTAMP WHERE "lastOpenedAt" IS NULL;

UPDATE "Contact" c
SET "lastPersonalSendAt" = GREATEST(c."lastPersonalSendAt", d.at)
FROM (
  SELECT dr."contactId", max(dr."sentAt") AS at
  FROM "Draft" dr
  WHERE dr."status" = 'SENT' AND dr."sentAt" IS NOT NULL
    AND NOT ('autopilot' = ANY(dr."flags"))
    AND NOT EXISTS (SELECT 1 FROM "OsEvent" e WHERE e."dedupeKey" = 'autopilot_sent:' || dr."id")
  GROUP BY dr."contactId"
) d
WHERE d."contactId" = c."id"
  AND c."lastPersonalSendAt" IS DISTINCT FROM GREATEST(c."lastPersonalSendAt", d.at);

DROP FUNCTION pg_temp.os_ts(text);
