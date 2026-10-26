-- CreateTable
CREATE TABLE "PaperAccount" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Paper account',
    "startingCashPaise" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resetAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperOrder" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "pricePaise" BIGINT,
    "triggerPaise" BIGINT,
    "status" TEXT NOT NULL,
    "triggered" BOOLEAN NOT NULL DEFAULT false,
    "avgFillPaise" BIGINT,
    "rejectReason" TEXT,
    "tag" TEXT,
    "tradeDate" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaperTrade" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "qty" INTEGER NOT NULL,
    "pricePaise" BIGINT NOT NULL,
    "chargesPaise" BIGINT NOT NULL,
    "charges" JSONB NOT NULL,
    "time" TIMESTAMP(3) NOT NULL,
    "tradeDate" TEXT NOT NULL,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaperOrder_accountId_status_idx" ON "PaperOrder"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PaperTrade_orderId_key" ON "PaperTrade"("orderId");

-- CreateIndex
CREATE INDEX "PaperTrade_accountId_time_idx" ON "PaperTrade"("accountId", "time");

-- AddForeignKey
ALTER TABLE "PaperOrder" ADD CONSTRAINT "PaperOrder_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaperOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "PaperAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
