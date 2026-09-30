-- Record when the user accepted the privacy policy (LGPD consent)
ALTER TABLE "user" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);