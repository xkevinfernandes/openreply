-- How sure J's triage was (Jev's calibrated probability, 0-1). Null for the
-- LLM backend. Set with suggestedKind null means "J isn't sure".
ALTER TABLE "Contact" ADD COLUMN "suggestedConfidence" DOUBLE PRECISION;
