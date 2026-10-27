-- CreateTable
CREATE TABLE "EquityEod" (
    "date" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "isin" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "openPaise" INTEGER NOT NULL,
    "highPaise" INTEGER NOT NULL,
    "lowPaise" INTEGER NOT NULL,
    "closePaise" INTEGER NOT NULL,
    "prevClosePaise" INTEGER NOT NULL,
    "volume" BIGINT NOT NULL,
    "trades" INTEGER,

    CONSTRAINT "EquityEod_pkey" PRIMARY KEY ("date","symbol")
);

-- CreateTable
CREATE TABLE "IndexEod" (
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "openPaise" INTEGER NOT NULL,
    "highPaise" INTEGER NOT NULL,
    "lowPaise" INTEGER NOT NULL,
    "closePaise" INTEGER NOT NULL,

    CONSTRAINT "IndexEod_pkey" PRIMARY KEY ("date","name")
);

-- CreateTable
CREATE TABLE "EodFetch" (
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EodFetch_pkey" PRIMARY KEY ("date")
);

-- CreateTable
CREATE TABLE "SignalStrategy" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "rulesHash" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "SignalStrategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignalIssue" (
    "id" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "closePaise" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignalIssue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EquityEod_symbol_date_idx" ON "EquityEod"("symbol", "date");

-- CreateIndex
CREATE INDEX "EquityEod_isin_idx" ON "EquityEod"("isin");

-- CreateIndex
CREATE UNIQUE INDEX "SignalStrategy_slug_version_key" ON "SignalStrategy"("slug", "version");

-- CreateIndex
CREATE INDEX "SignalIssue_date_idx" ON "SignalIssue"("date");

-- CreateIndex
CREATE UNIQUE INDEX "SignalIssue_strategyId_date_symbol_action_key" ON "SignalIssue"("strategyId", "date", "symbol", "action");

-- AddForeignKey
ALTER TABLE "SignalIssue" ADD CONSTRAINT "SignalIssue_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "SignalStrategy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
