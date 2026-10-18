-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('SALES', 'PERSONAL', 'UNSORTED');

-- CreateEnum
CREATE TYPE "ContactStage" AS ENUM ('NEW', 'LEAD_MAGNET_SENT', 'IN_CONVERSATION', 'QUALIFIED', 'NOT_QUALIFIED', 'CALL_OFFERED', 'CALL_BOOKED', 'SHOWED', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "username" TEXT,
    "fullName" TEXT,
    "avatarUrl" TEXT,
    "zernioConversationId" TEXT,
    "email" TEXT,
    "kind" "ContactKind" NOT NULL DEFAULT 'UNSORTED',
    "kindSource" TEXT,
    "stage" "ContactStage" NOT NULL DEFAULT 'NEW',
    "setterStage" TEXT,
    "entryPath" TEXT,
    "tags" TEXT[],
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Contact_workspaceId_kind_idx" ON "Contact"("workspaceId", "kind");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_stage_idx" ON "Contact"("workspaceId", "stage");

-- CreateIndex
CREATE INDEX "Contact_zernioConversationId_idx" ON "Contact"("zernioConversationId");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_workspaceId_instagramAccountId_igUserId_key" ON "Contact"("workspaceId", "instagramAccountId", "igUserId");
