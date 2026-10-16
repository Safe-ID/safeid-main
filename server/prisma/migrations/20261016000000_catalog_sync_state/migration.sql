-- CreateTable
CREATE TABLE "catalog_sync_state" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "lastSyncAt" TIMESTAMP(3) NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "catalog_sync_state_pkey" PRIMARY KEY ("id")
);

