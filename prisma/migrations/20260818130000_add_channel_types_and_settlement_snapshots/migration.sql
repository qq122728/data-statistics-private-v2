-- Keep existing FREE/PAID rows readable. New channel creation uses ChannelType.
ALTER TABLE "Channel" ADD COLUMN "channelType" TEXT NOT NULL DEFAULT 'SMS';
ALTER TABLE "Channel" ADD COLUMN "rebateRateBps" INTEGER;

ALTER TABLE "SourceBatch" ADD COLUMN "channelTypeSnapshot" TEXT NOT NULL DEFAULT 'SMS';
ALTER TABLE "SourceBatch" ADD COLUMN "rebateRateBpsSnapshot" INTEGER;
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingSpendCents" INTEGER;
ALTER TABLE "SourceBatch" ADD COLUMN "advertisingServiceFeeRateBps" INTEGER;

UPDATE "SourceBatch"
SET
  "channelTypeSnapshot" = COALESCE((
    SELECT "Channel"."channelType"
    FROM "Channel"
    WHERE "Channel"."id" = "SourceBatch"."channelId"
      AND "Channel"."groupId" = "SourceBatch"."groupId"
  ), 'SMS'),
  "rebateRateBpsSnapshot" = (
    SELECT "Channel"."rebateRateBps"
    FROM "Channel"
    WHERE "Channel"."id" = "SourceBatch"."channelId"
      AND "Channel"."groupId" = "SourceBatch"."groupId"
  );
