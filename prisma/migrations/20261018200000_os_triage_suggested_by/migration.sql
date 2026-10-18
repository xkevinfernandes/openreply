-- Which triage backend made the stored judgment (fake | llm | jev).
ALTER TABLE "Contact" ADD COLUMN "suggestedBy" TEXT;
