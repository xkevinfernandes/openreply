-- CreateTable
CREATE TABLE "ContactFieldValueHistory" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT,
    "raw" TEXT,
    "source" TEXT NOT NULL,
    "ref" TEXT,
    "applied" BOOLEAN NOT NULL DEFAULT true,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactFieldValueHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactSyncState" (
    "contactId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "pushedFields" JSONB NOT NULL DEFAULT '{}',
    "pushedEmail" TEXT,
    "removeTags" TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSyncState_pkey" PRIMARY KEY ("contactId","provider")
);

-- CreateIndex
CREATE INDEX "ContactFieldValueHistory_contactId_fieldId_at_idx" ON "ContactFieldValueHistory"("contactId", "fieldId", "at");

-- CreateIndex
CREATE INDEX "ContactFieldValueHistory_workspaceId_at_idx" ON "ContactFieldValueHistory"("workspaceId", "at");

-- CreateIndex
CREATE INDEX "ContactSyncState_workspaceId_idx" ON "ContactSyncState"("workspaceId");

