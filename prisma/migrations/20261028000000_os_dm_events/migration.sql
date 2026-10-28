-- DM events → DataOS: workflow links go through the tracked redirect.
-- Additive and nullable only: no drops, no data rewrites. Existing automation
-- links keep their automationId; only new workflow links leave it null.

ALTER TABLE "TrackedLink" ALTER COLUMN "automationId" DROP NOT NULL;
ALTER TABLE "TrackedLink" ADD COLUMN "workflowId" TEXT;
ALTER TABLE "TrackedLink" ADD COLUMN "runId" TEXT;
ALTER TABLE "TrackedLink" ADD COLUMN "nodeId" TEXT;
ALTER TABLE "TrackedLink" ADD COLUMN "resourceSlug" TEXT;
CREATE INDEX "TrackedLink_runId_idx" ON "TrackedLink"("runId");
