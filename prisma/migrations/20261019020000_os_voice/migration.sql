-- CreateEnum
CREATE TYPE "VoiceClipKind" AS ENUM ('BANK', 'MANUAL');

-- CreateTable
CREATE TABLE "VoiceAudio" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "ext" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceAudio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceClip" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "slot" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "phrase" TEXT NOT NULL DEFAULT '',
    "stage" TEXT,
    "kind" "VoiceClipKind" NOT NULL DEFAULT 'BANK',
    "leadIn" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "audioId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceClip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VoiceSend" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "clipId" TEXT,
    "audioId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "transcript" TEXT NOT NULL DEFAULT '',
    "bankKey" TEXT,
    "draftId" TEXT,
    "messageId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VoiceSend_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceAudio_workspaceId_idx" ON "VoiceAudio"("workspaceId");

-- CreateIndex
CREATE INDEX "VoiceClip_setterId_sortOrder_idx" ON "VoiceClip"("setterId", "sortOrder");

-- CreateIndex
CREATE INDEX "VoiceClip_workspaceId_idx" ON "VoiceClip"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "VoiceSend_bankKey_key" ON "VoiceSend"("bankKey");

-- CreateIndex
CREATE INDEX "VoiceSend_contactId_idx" ON "VoiceSend"("contactId");

-- CreateIndex
CREATE INDEX "VoiceSend_workspaceId_conversationId_idx" ON "VoiceSend"("workspaceId", "conversationId");

-- CreateIndex
CREATE INDEX "VoiceSend_messageId_idx" ON "VoiceSend"("messageId");

-- AddForeignKey
ALTER TABLE "VoiceClip" ADD CONSTRAINT "VoiceClip_setterId_fkey" FOREIGN KEY ("setterId") REFERENCES "Setter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VoiceClip" ADD CONSTRAINT "VoiceClip_audioId_fkey" FOREIGN KEY ("audioId") REFERENCES "VoiceAudio"("id") ON DELETE SET NULL ON UPDATE CASCADE;

