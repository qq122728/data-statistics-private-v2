-- SQLite development compatibility only. The features remain hidden and unused.
ALTER TABLE "Channel" ADD COLUMN "fanCostMode" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "Channel" ADD COLUMN "effectiveFanPriceCents" INTEGER;
ALTER TABLE "Channel" ADD COLUMN "rebateRateBps" INTEGER;

ALTER TABLE "SourceBatch" ADD COLUMN "fanCostModeSnapshot" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "SourceBatch" ADD COLUMN "effectiveFanPriceCentsSnapshot" INTEGER;
ALTER TABLE "SourceBatch" ADD COLUMN "rebateRateBpsSnapshot" INTEGER;
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingSpendCents" INTEGER;
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingFanCount" INTEGER;
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingServiceFeeRateBps" INTEGER;
