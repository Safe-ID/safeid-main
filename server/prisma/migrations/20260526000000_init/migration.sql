-- CreateTable
CREATE TABLE "user" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "scanSnapshot" JSONB,
    "scanSnapshotUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_history" (
    "id" SERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "emailHash" TEXT NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "classification" TEXT NOT NULL,
    "breachesFound" INTEGER,
    "breachData" TEXT,
    "recommendation" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breach_cache" (
    "id" SERIAL NOT NULL,
    "breachId" TEXT NOT NULL,
    "breachName" TEXT NOT NULL,
    "breachTitle" TEXT,
    "description" TEXT,
    "breachDate" TIMESTAMP(3),
    "exposedDataTypes" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT true,
    "cachedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "breach_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE INDEX "user_email_idx" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "scan_history_jobId_key" ON "scan_history"("jobId");

-- CreateIndex
CREATE INDEX "scan_history_userId_idx" ON "scan_history"("userId");

-- CreateIndex
CREATE INDEX "scan_history_emailHash_idx" ON "scan_history"("emailHash");

-- CreateIndex
CREATE INDEX "scan_history_createdAt_idx" ON "scan_history"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "breach_cache_breachId_key" ON "breach_cache"("breachId");

-- CreateIndex
CREATE INDEX "breach_cache_breachId_idx" ON "breach_cache"("breachId");

-- CreateIndex
CREATE INDEX "breach_cache_expiresAt_idx" ON "breach_cache"("expiresAt");

-- AddForeignKey
ALTER TABLE "scan_history" ADD CONSTRAINT "scan_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;