-- Trade lab: paper trading of stocks, futures and options on live prices.
ALTER TABLE "PaperOrder" ADD COLUMN "exchange" TEXT NOT NULL DEFAULT 'NSE';
ALTER TABLE "PaperOrder" ADD COLUMN "lotSize" INTEGER;
ALTER TABLE "PaperOrder" ADD COLUMN "parentId" TEXT;
ALTER TABLE "PaperOrder" ADD COLUMN "stopPaise" BIGINT;
ALTER TABLE "PaperOrder" ADD COLUMN "targetPaise" BIGINT;
ALTER TABLE "PaperOrder" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'MANUAL';
ALTER TABLE "PaperOrder" ADD COLUMN "reason" TEXT;
ALTER TABLE "PaperTrade" ADD COLUMN "exchange" TEXT NOT NULL DEFAULT 'NSE';
