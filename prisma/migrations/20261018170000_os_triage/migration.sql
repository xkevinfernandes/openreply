-- J's triage of Unsorted contacts (spec item 7).
ALTER TABLE "Contact" ADD COLUMN "suggestedKind" "ContactKind",
ADD COLUMN "suggestedReason" TEXT,
ADD COLUMN "triagedAt" TIMESTAMP(3),
ADD COLUMN "triagedMessageId" TEXT;
