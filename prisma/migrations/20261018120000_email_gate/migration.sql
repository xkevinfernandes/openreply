-- CreateEnum
CREATE TYPE "CrmProvider" AS ENUM ('KIT');

-- CreateEnum
CREATE TYPE "EmailCaptureStatus" AS ENUM ('AWAITING', 'CAPTURED', 'GAVE_UP');

-- AlterTable
ALTER TABLE "Automation" ADD COLUMN     "requireEmail" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailPromptMessage" TEXT,
ADD COLUMN     "emailRetryMessage" TEXT,
ADD COLUMN     "crmTagId" TEXT;

-- CreateTable
CREATE TABLE "CrmConnection" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" "CrmProvider" NOT NULL,
    "apiKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrmConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailCapture" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT,
    "status" "EmailCaptureStatus" NOT NULL DEFAULT 'AWAITING',
    "email" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "crmSyncedAt" TIMESTAMP(3),
    "crmError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailCapture_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CrmConnection_workspaceId_provider_key" ON "CrmConnection"("workspaceId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "EmailCapture_automationId_userId_key" ON "EmailCapture"("automationId", "userId");

-- CreateIndex
CREATE INDEX "EmailCapture_instagramAccountId_userId_status_idx" ON "EmailCapture"("instagramAccountId", "userId", "status");

-- CreateIndex
CREATE INDEX "EmailCapture_workspaceId_idx" ON "EmailCapture"("workspaceId");

-- AddForeignKey
ALTER TABLE "CrmConnection" ADD CONSTRAINT "CrmConnection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCapture" ADD CONSTRAINT "EmailCapture_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailCapture" ADD CONSTRAINT "EmailCapture_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
