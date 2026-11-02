-- AlterTable
ALTER TABLE "FnoDayMeta" ADD COLUMN     "isIndex" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "FnoFetch" ADD COLUMN     "scope" TEXT;

-- CreateTable
CREATE TABLE "FnoDerivedDay" (
    "date" TEXT NOT NULL,
    "underlying" TEXT NOT NULL,
    "expiry" TEXT NOT NULL,
    "daysToExpiry" INTEGER NOT NULL,
    "spotPaise" INTEGER,
    "forwardPaise" INTEGER,
    "strikeStepPaise" INTEGER,
    "atmStrikePaise" INTEGER,
    "atmIv" DOUBLE PRECISION,
    "straddlePaise" INTEGER,
    "straddleTraded" BOOLEAN NOT NULL DEFAULT false,
    "maxPainPaise" INTEGER,
    "ceOi" BIGINT NOT NULL,
    "peOi" BIGINT NOT NULL,
    "ceVolume" BIGINT NOT NULL,
    "peVolume" BIGINT NOT NULL,
    "gexNet" DOUBLE PRECISION,
    "callWallPaise" INTEGER,
    "putWallPaise" INTEGER,
    "gammaFlipPaise" INTEGER,
    "gexIvFilled" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "FnoDerivedDay_pkey" PRIMARY KEY ("date","underlying","expiry")
);

-- CreateIndex
CREATE INDEX "FnoDerivedDay_underlying_date_idx" ON "FnoDerivedDay"("underlying", "date");

-- CreateIndex
CREATE INDEX "FnoDayMeta_underlying_date_idx" ON "FnoDayMeta"("underlying", "date");
