-- CreateEnum
CREATE TYPE "WorkflowRunStatus" AS ENUM ('ACTIVE', 'WAITING', 'PAUSED', 'COMPLETED', 'EXITED', 'REPLACED', 'FAILED');

-- CreateTable
CREATE TABLE "Workflow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "instagramAccountId" TEXT,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'draft',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "currentVersionId" TEXT,
    "draftGraph" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowVersion" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "keywords" TEXT[],
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "contactId" TEXT,
    "status" "WorkflowRunStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentNodeId" TEXT,
    "waitUntil" TIMESTAMP(3),
    "waitingFor" TEXT,
    "keyword" TEXT,
    "trigger" JSONB NOT NULL DEFAULT '{}',
    "setterState" JSONB NOT NULL DEFAULT '{}',
    "state" JSONB NOT NULL DEFAULT '{}',
    "liveKey" TEXT,
    "pausedAt" TIMESTAMP(3),
    "pausedReason" TEXT,
    "exit" TEXT,
    "failReason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRunEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "port" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowRandomizerAssignment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "nodeId" TEXT NOT NULL,
    "instagramAccountId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowRandomizerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInbound" (
    "key" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowInbound_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "WorkflowOutbound" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "igUserId" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkflowOutbound_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Workflow_workspaceId_idx" ON "Workflow"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowVersion_workflowId_number_key" ON "WorkflowVersion"("workflowId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRun_liveKey_key" ON "WorkflowRun"("liveKey");

-- CreateIndex
CREATE INDEX "WorkflowRun_workspaceId_status_idx" ON "WorkflowRun"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_workflowId_status_idx" ON "WorkflowRun"("workflowId", "status");

-- CreateIndex
CREATE INDEX "WorkflowRun_instagramAccountId_igUserId_keyword_startedAt_idx" ON "WorkflowRun"("instagramAccountId", "igUserId", "keyword", "startedAt");

-- CreateIndex
CREATE INDEX "WorkflowRun_contactId_idx" ON "WorkflowRun"("contactId");

-- CreateIndex
CREATE INDEX "WorkflowRun_status_waitUntil_idx" ON "WorkflowRun"("status", "waitUntil");

-- CreateIndex
CREATE INDEX "WorkflowRunEvent_workflowId_at_idx" ON "WorkflowRunEvent"("workflowId", "at");

-- CreateIndex
CREATE INDEX "WorkflowRunEvent_runId_idx" ON "WorkflowRunEvent"("runId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowRandomizerAssignment_workflowId_nodeId_instagramAcc_key" ON "WorkflowRandomizerAssignment"("workflowId", "nodeId", "instagramAccountId", "igUserId");

-- CreateIndex
CREATE INDEX "WorkflowInbound_at_idx" ON "WorkflowInbound"("at");

-- CreateIndex
CREATE INDEX "WorkflowOutbound_igUserId_at_idx" ON "WorkflowOutbound"("igUserId", "at");

-- AddForeignKey
ALTER TABLE "WorkflowVersion" ADD CONSTRAINT "WorkflowVersion_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "Workflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRun" ADD CONSTRAINT "WorkflowRun_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "WorkflowVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowRunEvent" ADD CONSTRAINT "WorkflowRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "WorkflowRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
