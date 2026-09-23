-- Allow accounts authenticated by Google OAuth
ALTER TABLE "user" ADD COLUMN "googleId" TEXT;

-- Local accounts keep passwords, Google accounts may not have one
ALTER TABLE "user" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- One Google identity per SafeID account
CREATE UNIQUE INDEX "user_googleId_key" ON "user"("googleId");