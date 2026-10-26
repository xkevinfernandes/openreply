-- DM CRM part A (factory/dm-crm/prd.md "Schema changes (all of them)"): every
-- additive table and column of the build. Data moves are in the three
-- migrations after this one; the Broadcast columns that go are dropped by
-- 20261027030000_os_crm_broadcasts_oneoff once its runs are split.

-- Contact: inbox state (slice 3).
ALTER TABLE "Contact" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "lastInboundAt" TIMESTAMP(3),
ADD COLUMN     "lastOpenedAt" TIMESTAMP(3),
ADD COLUMN     "lastOutboundAt" TIMESTAMP(3),
ADD COLUMN     "lastPersonalSendAt" TIMESTAMP(3),
ADD COLUMN     "spam" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "spamOverride" BOOLEAN,
ADD COLUMN     "starred" BOOLEAN NOT NULL DEFAULT false;

-- Workspace currency (slice 6 / Won picker).
ALTER TABLE "OsWorkspace" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'EUR';

-- Broadcast one-offs (slice 5): new columns only; the old ones go later.
ALTER TABLE "Broadcast" ADD COLUMN     "audienceTagId" TEXT,
ADD COLUMN     "bubbles" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "contactIds" TEXT[],
ADD COLUMN     "duplicatedFromId" TEXT,
ADD COLUMN     "personaliseMode" TEXT NOT NULL DEFAULT 'per_person',
ADD COLUMN     "sendDate" TEXT,
ADD COLUMN     "startMode" TEXT NOT NULL DEFAULT 'window',
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'draft',
ADD COLUMN     "variations" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "BroadcastMessage" ADD COLUMN     "includedAnyway" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "leftOutReason" TEXT,
ADD COLUMN     "sentLinks" TEXT[],
ADD COLUMN     "skipReason" TEXT;

ALTER TABLE "BroadcastRun" ALTER COLUMN "link" DROP NOT NULL;

-- Stage log (slice 1).
CREATE TABLE "ContactStageLog" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "setterId" TEXT,
    "fromColumn" TEXT,
    "toColumn" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactStageLog_pkey" PRIMARY KEY ("id")
);

-- Saved views (slice 4).
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'contacts',
    "name" TEXT NOT NULL,
    "columns" JSONB NOT NULL DEFAULT '[]',
    "filters" JSONB NOT NULL DEFAULT '{}',
    "sort" JSONB NOT NULL DEFAULT '{}',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- Managed tags and their old names (slice 2).
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'gray',
    "kitNames" TEXT[],
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TagAlias" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TagAlias_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ContactStageLog_contactId_at_idx" ON "ContactStageLog"("contactId", "at");
CREATE INDEX "ContactStageLog_workspaceId_at_idx" ON "ContactStageLog"("workspaceId", "at");
CREATE INDEX "SavedView_workspaceId_scope_idx" ON "SavedView"("workspaceId", "scope");
CREATE UNIQUE INDEX "SavedView_workspaceId_scope_name_key" ON "SavedView"("workspaceId", "scope", "name");
CREATE UNIQUE INDEX "Tag_workspaceId_key_key" ON "Tag"("workspaceId", "key");
CREATE UNIQUE INDEX "Tag_workspaceId_name_key" ON "Tag"("workspaceId", "name");
CREATE INDEX "TagAlias_workspaceId_key_idx" ON "TagAlias"("workspaceId", "key");
CREATE INDEX "TagAlias_tagId_idx" ON "TagAlias"("tagId");
CREATE UNIQUE INDEX "TagAlias_workspaceId_name_key" ON "TagAlias"("workspaceId", "name");
CREATE INDEX "Broadcast_workspaceId_createdAt_idx" ON "Broadcast"("workspaceId", "createdAt");
CREATE INDEX "Contact_workspaceId_lastMessageAt_idx" ON "Contact"("workspaceId", "lastMessageAt");
CREATE INDEX "Contact_workspaceId_archivedAt_idx" ON "Contact"("workspaceId", "archivedAt");

ALTER TABLE "ContactStageLog" ADD CONSTRAINT "ContactStageLog_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TagAlias" ADD CONSTRAINT "TagAlias_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
