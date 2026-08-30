-- The new application does not use pricing fields, but the previous release still expects them.
-- Restore the columns and their exact values so an application rollback remains possible.
CREATE TYPE "FanCostMode" AS ENUM ('FREE', 'PAID');

ALTER TABLE "Channel"
  ADD COLUMN "fanCostMode" "FanCostMode" NOT NULL DEFAULT 'FREE',
  ADD COLUMN "effectiveFanPriceCents" INTEGER,
  ADD COLUMN "rebateRateBps" INTEGER;

ALTER TABLE "SourceBatch"
  ADD COLUMN "fanCostModeSnapshot" "FanCostMode" NOT NULL DEFAULT 'FREE',
  ADD COLUMN "effectiveFanPriceCentsSnapshot" INTEGER,
  ADD COLUMN "rebateRateBpsSnapshot" INTEGER,
  ADD COLUMN "advertisingSpendCents" INTEGER,
  ADD COLUMN "advertisingFanCount" INTEGER,
  ADD COLUMN "advertisingServiceFeeRateBps" INTEGER;

UPDATE "Channel" AS channel
SET
  "fanCostMode" = archive."fanCostMode"::"FanCostMode",
  "effectiveFanPriceCents" = archive."effectiveFanPriceCents",
  "rebateRateBps" = archive."rebateRateBps"
FROM "_LegacyChannelCostArchive" AS archive
WHERE channel."id" = archive."id" AND channel."groupId" = archive."groupId";

UPDATE "SourceBatch" AS batch
SET
  "fanCostModeSnapshot" = archive."fanCostModeSnapshot"::"FanCostMode",
  "effectiveFanPriceCentsSnapshot" = archive."effectiveFanPriceCentsSnapshot",
  "rebateRateBpsSnapshot" = archive."rebateRateBpsSnapshot",
  "advertisingSpendCents" = archive."advertisingSpendCents",
  "advertisingFanCount" = archive."advertisingFanCount",
  "advertisingServiceFeeRateBps" = archive."advertisingServiceFeeRateBps"
FROM "_LegacySourceBatchCostArchive" AS archive
WHERE batch."id" = archive."id";

DROP TABLE "_LegacySourceBatchCostArchive";
DROP TABLE "_LegacyChannelCostArchive";
