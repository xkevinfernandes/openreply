-- What the one-time Lead Flow / contacts.json imports wrote, so a re-run never
-- overwrites a stage or kind the user changed in the DM OS afterwards.
ALTER TABLE "Contact" ADD COLUMN "imported" JSONB;
