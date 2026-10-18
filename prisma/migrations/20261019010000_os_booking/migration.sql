-- Calendar booking: J books calls in the DM through Cal.com or Calendly.
CREATE TYPE "BookingStatus" AS ENUM ('BOOKED', 'CONFIRMED', 'LINK_SENT', 'CANCELLED');

ALTER TABLE "OsIntegration" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "Draft" ADD COLUMN "booking" JSONB;

CREATE TABLE "Booking" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "draftId" TEXT,
    "provider" TEXT NOT NULL,
    "eventTypeId" TEXT NOT NULL,
    "eventName" TEXT,
    "externalId" TEXT,
    "start" TIMESTAMP(3) NOT NULL,
    "end" TIMESTAMP(3),
    "timezone" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'BOOKED',
    "url" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Booking_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Booking_draftId_key" ON "Booking"("draftId");
CREATE INDEX "Booking_workspaceId_start_idx" ON "Booking"("workspaceId", "start");
CREATE INDEX "Booking_contactId_idx" ON "Booking"("contactId");

ALTER TABLE "Booking" ADD CONSTRAINT "Booking_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
