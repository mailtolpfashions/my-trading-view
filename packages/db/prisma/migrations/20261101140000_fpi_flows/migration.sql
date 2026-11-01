-- CreateTable
CREATE TABLE "FpiFlow" (
    "reportDate" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "purchaseCr" DECIMAL(18,2) NOT NULL,
    "salesCr" DECIMAL(18,2) NOT NULL,
    "netCr" DECIMAL(18,2) NOT NULL,
    "netUsdMn" DECIMAL(18,2) NOT NULL,
    "usdInr" DECIMAL(10,4),

    CONSTRAINT "FpiFlow_pkey" PRIMARY KEY ("reportDate","category","route")
);

