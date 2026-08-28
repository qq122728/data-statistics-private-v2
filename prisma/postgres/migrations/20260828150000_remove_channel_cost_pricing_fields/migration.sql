-- AlterTable
ALTER TABLE "Channel" DROP COLUMN "fanCostMode",
DROP COLUMN "effectiveFanPriceCents",
DROP COLUMN "rebateRateBps";

-- AlterTable
ALTER TABLE "SourceBatch" DROP COLUMN "fanCostModeSnapshot",
DROP COLUMN "effectiveFanPriceCentsSnapshot",
DROP COLUMN "rebateRateBpsSnapshot",
DROP COLUMN "advertisingSpendCents",
DROP COLUMN "advertisingFanCount",
DROP COLUMN "advertisingServiceFeeRateBps";

-- DropEnum
DROP TYPE "FanCostMode";
