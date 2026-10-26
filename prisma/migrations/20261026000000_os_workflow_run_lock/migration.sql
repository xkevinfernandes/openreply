-- A short per-run lease so a tap and the timer never advance one run at once.
ALTER TABLE "WorkflowRun" ADD COLUMN "lockToken" TEXT,
ADD COLUMN "lockedUntil" TIMESTAMP(3);
