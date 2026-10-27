-- CreateTable
CREATE TABLE "CorporateAction" (
    "symbol" TEXT NOT NULL,
    "exDate" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "recordDate" TEXT,
    "firstSeen" TEXT NOT NULL,

    CONSTRAINT "CorporateAction_pkey" PRIMARY KEY ("symbol","exDate","purpose")
);

-- CreateIndex
CREATE INDEX "CorporateAction_exDate_idx" ON "CorporateAction"("exDate");
