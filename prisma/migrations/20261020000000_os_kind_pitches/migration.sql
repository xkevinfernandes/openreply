-- Its own migration: Postgres cannot use a new enum value in the same
-- transaction that adds it.
ALTER TYPE "ContactKind" ADD VALUE IF NOT EXISTS 'PITCHES';
