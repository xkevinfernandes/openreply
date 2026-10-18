-- Integrations (DM OS build step 7): provider settings and a per-contact sync log.
CREATE TABLE "OsIntegration" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "credentials" TEXT,
    "locationId" TEXT,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastTestedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsIntegration_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactSync" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "externalId" TEXT,
    "lastHash" TEXT,
    "pushedTags" TEXT[],
    "lastEvent" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "lastErrorAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactSync_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OsIntegration_workspaceId_provider_key" ON "OsIntegration"("workspaceId", "provider");
CREATE UNIQUE INDEX "ContactSync_contactId_provider_key" ON "ContactSync"("contactId", "provider");
CREATE INDEX "ContactSync_workspaceId_provider_idx" ON "ContactSync"("workspaceId", "provider");

ALTER TABLE "ContactSync" ADD CONSTRAINT "ContactSync_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
