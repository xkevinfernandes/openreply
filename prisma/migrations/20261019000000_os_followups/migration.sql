-- Follow-ups screen: the Friday list flag, nudge snooze, and the Friday send log.
ALTER TABLE "Contact" ADD COLUMN "onFriday" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "fridayAddedAt" TIMESTAMP(3);

ALTER TABLE "SetterState" ADD COLUMN "snoozedUntil" TIMESTAMP(3);

CREATE TABLE "FridaySend" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceSlug" TEXT NOT NULL,
    "friday" TEXT NOT NULL,
    "bubbles" TEXT[],
    "humanAgent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "FridaySend_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FridaySend_contactId_resourceSlug_key" ON "FridaySend"("contactId", "resourceSlug");
CREATE INDEX "FridaySend_workspaceId_friday_idx" ON "FridaySend"("workspaceId", "friday");
CREATE INDEX "Contact_workspaceId_onFriday_idx" ON "Contact"("workspaceId", "onFriday");

ALTER TABLE "FridaySend" ADD CONSTRAINT "FridaySend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
