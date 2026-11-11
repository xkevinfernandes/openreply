-- Settings › Connections: audit fields and activity log. Additive only: two new
-- tables, no existing table touched, so the previous build ignores them.

-- CreateTable
CREATE TABLE "OsConnection" (
    "workspaceId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "connectedById" TEXT,
    "connectedAt" TIMESTAMP(3),
    "account" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastOkAt" TIMESTAMP(3),
    "lastError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsConnection_pkey" PRIMARY KEY ("workspaceId","service")
);

-- CreateTable
CREATE TABLE "OsConnectionEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OsConnectionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OsConnectionEvent_workspaceId_service_at_idx" ON "OsConnectionEvent"("workspaceId", "service", "at");
