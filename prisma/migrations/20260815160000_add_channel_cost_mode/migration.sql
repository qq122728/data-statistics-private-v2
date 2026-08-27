-- 免费渠道与付费渠道必须明确区分。历史上未填写价格的渠道按免费渠道处理。
ALTER TABLE "Channel" ADD COLUMN "fanCostMode" TEXT NOT NULL DEFAULT 'FREE';

UPDATE "Channel"
SET "fanCostMode" = CASE
  WHEN "effectiveFanPriceCents" IS NULL THEN 'FREE'
  ELSE 'PAID'
END;

-- 财务计算始终收到明确价格：免费渠道的单价固定为 0 分。
UPDATE "Channel"
SET "effectiveFanPriceCents" = 0
WHERE "fanCostMode" = 'FREE' AND "effectiveFanPriceCents" IS NULL;
