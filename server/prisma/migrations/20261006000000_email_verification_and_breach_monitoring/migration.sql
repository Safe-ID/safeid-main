-- AlterTable
ALTER TABLE "user" ADD COLUMN     "breachBaselineAt" TIMESTAMP(3),
ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "lastMonitoredAt" TIMESTAMP(3),
ADD COLUMN     "monitoringConsentAt" TIMESTAMP(3),
ADD COLUMN     "monitoringEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "scan_history" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'MANUAL';

-- DropTable
DROP TABLE "breach_cache";

-- CreateTable
CREATE TABLE "email_verification_token" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_breach" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "breachName" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "user_breach_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breach_catalog" (
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "domain" TEXT,
    "breachDate" TIMESTAMP(3),
    "addedDate" TIMESTAMP(3) NOT NULL,
    "modifiedDate" TIMESTAMP(3) NOT NULL,
    "pwnCount" BIGINT NOT NULL,
    "dataClasses" JSONB NOT NULL,
    "isVerified" BOOLEAN NOT NULL,
    "isFabricated" BOOLEAN NOT NULL,
    "isSensitive" BOOLEAN NOT NULL,
    "isRetired" BOOLEAN NOT NULL,
    "isSpamList" BOOLEAN NOT NULL,
    "isMalware" BOOLEAN NOT NULL,
    "isStealerLog" BOOLEAN NOT NULL,
    "raw" JSONB NOT NULL,
    "syncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breach_catalog_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "emailStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "emailSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_verification_token_tokenHash_key" ON "email_verification_token"("tokenHash");

-- CreateIndex
CREATE INDEX "email_verification_token_userId_idx" ON "email_verification_token"("userId");

-- CreateIndex
CREATE INDEX "user_breach_breachName_idx" ON "user_breach"("breachName");

-- CreateIndex
CREATE UNIQUE INDEX "user_breach_userId_breachName_key" ON "user_breach"("userId", "breachName");

-- CreateIndex
CREATE INDEX "breach_catalog_addedDate_idx" ON "breach_catalog"("addedDate");

-- CreateIndex
CREATE INDEX "breach_catalog_modifiedDate_idx" ON "breach_catalog"("modifiedDate");

-- CreateIndex
CREATE INDEX "notification_userId_readAt_idx" ON "notification"("userId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_userId_dedupeKey_key" ON "notification"("userId", "dedupeKey");

-- CreateIndex
CREATE INDEX "user_monitoringEnabled_emailVerifiedAt_idx" ON "user"("monitoringEnabled", "emailVerifiedAt");

-- AddForeignKey
ALTER TABLE "email_verification_token" ADD CONSTRAINT "email_verification_token_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_breach" ADD CONSTRAINT "user_breach_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contas Google já são verificadas pelo provedor
UPDATE "user" SET "emailVerifiedAt" = "createdAt" WHERE "googleId" IS NOT NULL;

-- Usuários existentes: monitoramento ligado (serão avisados no 1º e-mail, com opt-out)
UPDATE "user" SET "monitoringConsentAt" = NOW() WHERE "monitoringEnabled" = true;
