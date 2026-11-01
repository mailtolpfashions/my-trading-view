-- CreateTable
CREATE TABLE "ParticipantOi" (
    "date" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "participant" TEXT NOT NULL,
    "futIdxLong" BIGINT NOT NULL,
    "futIdxShort" BIGINT NOT NULL,
    "futStkLong" BIGINT NOT NULL,
    "futStkShort" BIGINT NOT NULL,
    "optIdxCallLong" BIGINT NOT NULL,
    "optIdxPutLong" BIGINT NOT NULL,
    "optIdxCallShort" BIGINT NOT NULL,
    "optIdxPutShort" BIGINT NOT NULL,
    "optStkCallLong" BIGINT NOT NULL,
    "optStkPutLong" BIGINT NOT NULL,
    "optStkCallShort" BIGINT NOT NULL,
    "optStkPutShort" BIGINT NOT NULL,
    "totalLong" BIGINT NOT NULL,
    "totalShort" BIGINT NOT NULL,

    CONSTRAINT "ParticipantOi_pkey" PRIMARY KEY ("date","kind","participant")
);

-- CreateTable
CREATE TABLE "ParticipantFetch" (
    "date" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParticipantFetch_pkey" PRIMARY KEY ("date")
);

