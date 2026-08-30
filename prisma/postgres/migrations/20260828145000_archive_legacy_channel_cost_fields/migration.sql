-- Preserve every legacy pricing value before the already-published removal migration runs.
-- The temporary tables are removed only after the compatibility columns have been restored.
CREATE TABLE "_LegacyChannelCostArchive" AS
SELECT
  "id",
  "groupId",
  "fanCostMode"::TEXT AS "fanCostMode",
  "effectiveFanPriceCents",
  "rebateRateBps"
FROM "Channel";

ALTER TABLE "_LegacyChannelCostArchive"
  ADD CONSTRAINT "_LegacyChannelCostArchive_pkey" PRIMARY KEY ("id", "groupId");

CREATE TABLE "_LegacySourceBatchCostArchive" AS
SELECT
  "id",
  "fanCostModeSnapshot"::TEXT AS "fanCostModeSnapshot",
  "effectiveFanPriceCentsSnapshot",
  "rebateRateBpsSnapshot",
  "advertisingSpendCents",
  "advertisingFanCount",
  "advertisingServiceFeeRateBps"
FROM "SourceBatch";

ALTER TABLE "_LegacySourceBatchCostArchive"
  ADD CONSTRAINT "_LegacySourceBatchCostArchive_pkey" PRIMARY KEY ("id");
