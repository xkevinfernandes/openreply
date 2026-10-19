
-- CreateEnum
CREATE TYPE "Attendance" AS ENUM ('SHOWED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "FollowupStepStatus" AS ENUM ('QUEUED', 'DRAFTED', 'SENT', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OsTaskStatus" AS ENUM ('OPEN', 'DONE', 'DISMISSED');

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "attendance" "Attendance",
ADD COLUMN     "attendanceAt" TIMESTAMP(3),
ADD COLUMN     "attendanceSource" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "rescheduledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "followupsOff" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OsIntegration" ADD COLUMN     "webhookSecret" TEXT;

-- CreateTable
CREATE TABLE "FollowupSequence" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowupSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowupStep" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "setterId" TEXT,
    "sequence" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "episode" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "FollowupStepStatus" NOT NULL DEFAULT 'QUEUED',
    "liveContactId" TEXT,
    "step" JSONB NOT NULL,
    "draftId" TEXT,
    "bookingId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "FollowupStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OsTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" "OsTaskStatus" NOT NULL DEFAULT 'OPEN',
    "dedupeKey" TEXT NOT NULL,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "OsTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FollowupSequence_workspaceId_idx" ON "FollowupSequence"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowupSequence_setterId_key_key" ON "FollowupSequence"("setterId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "FollowupStep_key_key" ON "FollowupStep"("key");

-- CreateIndex
CREATE UNIQUE INDEX "FollowupStep_liveContactId_key" ON "FollowupStep"("liveContactId");

-- CreateIndex
CREATE INDEX "FollowupStep_workspaceId_status_dueAt_idx" ON "FollowupStep"("workspaceId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "FollowupStep_contactId_sequence_idx" ON "FollowupStep"("contactId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "OsTask_dedupeKey_key" ON "OsTask"("dedupeKey");

-- CreateIndex
CREATE INDEX "OsTask_workspaceId_status_idx" ON "OsTask"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "OsTask_contactId_idx" ON "OsTask"("contactId");

-- CreateIndex
CREATE INDEX "Booking_workspaceId_externalId_idx" ON "Booking"("workspaceId", "externalId");

-- AddForeignKey
ALTER TABLE "FollowupSequence" ADD CONSTRAINT "FollowupSequence_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "Setter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowupStep" ADD CONSTRAINT "FollowupStep_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OsTask" ADD CONSTRAINT "OsTask_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

