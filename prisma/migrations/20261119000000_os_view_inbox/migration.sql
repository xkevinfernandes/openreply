-- View-only inboxes (/os/view): a client's DMs read with their own Zernio key.
-- Additive only: one new table, no existing table touched, so the previous
-- build ignores it.

-- CreateTable
CREATE TABLE "OsViewInbox" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "apiKey" TEXT NOT NULL,
    "zernioAccountId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OsViewInbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OsViewInbox_workspaceId_idx" ON "OsViewInbox"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "OsViewInbox_workspaceId_zernioAccountId_key" ON "OsViewInbox"("workspaceId", "zernioAccountId");
