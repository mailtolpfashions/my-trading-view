-- CreateTable
CREATE TABLE "FiiDerivStat" (
    "date" TEXT NOT NULL,
    "segment" TEXT NOT NULL,
    "buyContracts" BIGINT NOT NULL,
    "buyCr" DECIMAL(18,4) NOT NULL,
    "sellContracts" BIGINT NOT NULL,
    "sellCr" DECIMAL(18,4) NOT NULL,
    "oiContracts" BIGINT NOT NULL,
    "oiCr" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "FiiDerivStat_pkey" PRIMARY KEY ("date","segment")
);

-- CreateTable
CREATE TABLE "FiiStatFetch" (
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FiiStatFetch_pkey" PRIMARY KEY ("date")
);

