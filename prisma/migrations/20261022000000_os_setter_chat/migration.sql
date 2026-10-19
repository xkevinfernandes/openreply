-- CreateTable
CREATE TABLE "SetterChatMessage" (
    "id" TEXT NOT NULL,
    "setterId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "edits" JSONB NOT NULL DEFAULT '[]',
    "test" JSONB,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SetterChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SetterChatMessage_setterId_createdAt_idx" ON "SetterChatMessage"("setterId", "createdAt");
