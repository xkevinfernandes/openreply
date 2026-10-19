-- Setter hand-off per campaign (prisma/os-automations.prisma). No row = Setter
-- Off. Every campaign that exists now keeps its current behaviour (J takes over
-- once they reply), so it gets setterOn = true.
CREATE TABLE "CampaignHandoff" (
    "automationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "setterOn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignHandoff_pkey" PRIMARY KEY ("automationId")
);

CREATE INDEX "CampaignHandoff_workspaceId_idx" ON "CampaignHandoff"("workspaceId");

INSERT INTO "CampaignHandoff" ("automationId", "workspaceId", "setterOn", "createdAt", "updatedAt")
SELECT a."id", a."workspaceId", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Automation" a
ON CONFLICT ("automationId") DO NOTHING;
