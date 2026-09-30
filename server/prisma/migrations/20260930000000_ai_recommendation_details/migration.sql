-- Keep the full AI recommendation, not only the summary
ALTER TABLE "scan_history" ADD COLUMN "mitigationSteps" JSONB;
ALTER TABLE "scan_history" ADD COLUMN "urgencyLevel" TEXT;