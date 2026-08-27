-- Corrections retain the original record and identify who corrected it.
ALTER TABLE "CustomerOrder" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "CustomerOrder" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "voidedById" TEXT;

ALTER TABLE "MetricEvent" ADD COLUMN "voidedAt" DATETIME;
ALTER TABLE "MetricEvent" ADD COLUMN "voidReason" TEXT;
ALTER TABLE "MetricEvent" ADD COLUMN "voidedById" TEXT;
