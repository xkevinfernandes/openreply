-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'LONG_TEXT', 'NUMBER', 'EMAIL', 'DATE', 'TIMEZONE', 'SELECT', 'URL');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "seenAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "heldAt" TIMESTAMP(3),
ADD COLUMN     "heldReason" TEXT;

-- CreateTable
CREATE TABLE "OsWorkspace" (
    "workspaceId" TEXT NOT NULL,
    "sendCapPerDay" INTEGER NOT NULL DEFAULT 80,
    "pausedAll" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Luxembourg',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsWorkspace_pkey" PRIMARY KEY ("workspaceId")
);

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" "CustomFieldType" NOT NULL DEFAULT 'TEXT',
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "options" JSONB NOT NULL DEFAULT '[]',
    "ghlField" TEXT,
    "kitField" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetterField" (
    "setterId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,

    CONSTRAINT "SetterField_pkey" PRIMARY KEY ("setterId","fieldId")
);

-- CreateTable
CREATE TABLE "ContactFieldValue" (
    "contactId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'j',
    "draftId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactFieldValue_pkey" PRIMARY KEY ("contactId","fieldId")
);

-- CreateTable
CREATE TABLE "CampaignResource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageMedia" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "transcript" TEXT,
    "description" TEXT,
    "caption" TEXT,
    "story" JSONB,
    "provider" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT,
    "setterId" TEXT,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dedupeKey" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "OsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetterDoc" (
    "id" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SetterDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SetterDocRevision" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetterDocRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "audienceTag" TEXT NOT NULL,
    "link" TEXT,
    "template" TEXT NOT NULL DEFAULT '',
    "followupTemplate" TEXT,
    "followupDelayMin" INTEGER NOT NULL DEFAULT 5,
    "windowDay" INTEGER NOT NULL DEFAULT 5,
    "windowStart" TEXT NOT NULL DEFAULT '10:00',
    "windowEnd" TEXT NOT NULL DEFAULT '15:00',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Luxembourg',
    "setterId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastRun" (
    "id" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "runDate" TEXT NOT NULL,
    "link" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'drafting',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastMessage" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "bubbles" TEXT[],
    "followupBubbles" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'drafted',
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "error" TEXT,
    "reasoning" TEXT,

    CONSTRAINT "BroadcastMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomField_workspaceId_sortOrder_idx" ON "CustomField"("workspaceId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_workspaceId_key_key" ON "CustomField"("workspaceId", "key");

-- CreateIndex
CREATE INDEX "SetterField_fieldId_idx" ON "SetterField"("fieldId");

-- CreateIndex
CREATE INDEX "ContactFieldValue_fieldId_idx" ON "ContactFieldValue"("fieldId");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignResource_automationId_key" ON "CampaignResource"("automationId");

-- CreateIndex
CREATE INDEX "CampaignResource_workspaceId_idx" ON "CampaignResource"("workspaceId");

-- CreateIndex
CREATE INDEX "CampaignResource_resourceId_idx" ON "CampaignResource"("resourceId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageMedia_messageId_key" ON "MessageMedia"("messageId");

-- CreateIndex
CREATE INDEX "MessageMedia_workspaceId_conversationId_idx" ON "MessageMedia"("workspaceId", "conversationId");

-- CreateIndex
CREATE UNIQUE INDEX "OsEvent_dedupeKey_key" ON "OsEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OsEvent_workspaceId_kind_at_idx" ON "OsEvent"("workspaceId", "kind", "at");

-- CreateIndex
CREATE INDEX "OsEvent_contactId_idx" ON "OsEvent"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "SetterDoc_setterId_key_key" ON "SetterDoc"("setterId", "key");

-- CreateIndex
CREATE INDEX "SetterDocRevision_docId_createdAt_idx" ON "SetterDocRevision"("docId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Broadcast_workspaceId_key_key" ON "Broadcast"("workspaceId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastRun_broadcastId_runDate_key" ON "BroadcastRun"("broadcastId", "runDate");

-- CreateIndex
CREATE INDEX "BroadcastMessage_workspaceId_status_idx" ON "BroadcastMessage"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastMessage_runId_contactId_key" ON "BroadcastMessage"("runId", "contactId");

-- AddForeignKey
ALTER TABLE "SetterField" ADD CONSTRAINT "SetterField_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactFieldValue" ADD CONSTRAINT "ContactFieldValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "CustomField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SetterDocRevision" ADD CONSTRAINT "SetterDocRevision_docId_fkey" FOREIGN KEY ("docId") REFERENCES "SetterDoc"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRun" ADD CONSTRAINT "BroadcastRun_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastMessage" ADD CONSTRAINT "BroadcastMessage_runId_fkey" FOREIGN KEY ("runId") REFERENCES "BroadcastRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

