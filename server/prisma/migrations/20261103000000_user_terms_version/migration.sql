-- Record which version of the terms and privacy policy the user accepted
ALTER TABLE "user" ADD COLUMN "termsVersion" TEXT;
