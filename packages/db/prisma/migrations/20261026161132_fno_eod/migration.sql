-- CreateTable
CREATE TABLE "FnoEod" (
    "date" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "expiry" TEXT NOT NULL,
    "strikePaise" INTEGER NOT NULL,
    "openPaise" INTEGER NOT NULL,
    "highPaise" INTEGER NOT NULL,
    "lowPaise" INTEGER NOT NULL,
    "closePaise" INTEGER NOT NULL,
    "settlePaise" INTEGER NOT NULL,
    "oi" BIGINT NOT NULL,
    "volume" BIGINT NOT NULL,
    "traded" BOOLEAN NOT NULL,

    CONSTRAINT "FnoEod_pkey" PRIMARY KEY ("date","underlying","kind","expiry","strikePaise")
);

-- CreateTable
CREATE TABLE "FnoDayMeta" (
    "date" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "lotSize" INTEGER,
    "spotPaise" INTEGER,
    "source" TEXT NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FnoDayMeta_pkey" PRIMARY KEY ("date","underlying")
);

-- CreateTable
CREATE TABLE "FnoFetch" (
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FnoFetch_pkey" PRIMARY KEY ("date")
);

-- CreateIndex
CREATE INDEX "FnoEod_underlying_expiry_kind_strikePaise_idx" ON "FnoEod"("underlying", "expiry", "kind", "strikePaise");
