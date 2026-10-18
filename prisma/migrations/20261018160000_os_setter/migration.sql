-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('PENDING', 'APPROVED', 'SENT', 'DISCARDED');

-- CreateTable
CREATE TABLE "SetterState" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "record" JSONB NOT NULL,
    "nextActionKind" TEXT,
    "nextActionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SetterState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "anchor" TEXT NOT NULL,
    "bubbles" TEXT[],
    "status" "DraftStatus" NOT NULL DEFAULT 'PENDING',
    "reasoning" TEXT,
    "setterStage" TEXT,
    "humanAgent" BOOLEAN NOT NULL DEFAULT false,
    "flags" TEXT[],
    "proposedTags" JSONB,
    "raw" JSONB,
    "backend" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "editedText" TEXT,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "sendError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SetterState_contactId_key" ON "SetterState"("contactId");

-- CreateIndex
CREATE INDEX "SetterState_workspaceId_state_idx" ON "SetterState"("workspaceId", "state");

-- CreateIndex
CREATE INDEX "SetterState_nextActionAt_idx" ON "SetterState"("nextActionAt");

-- CreateIndex
CREATE INDEX "Draft_workspaceId_status_idx" ON "Draft"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Draft_contactId_status_idx" ON "Draft"("contactId", "status");

-- AddForeignKey
ALTER TABLE "SetterState" ADD CONSTRAINT "SetterState_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
