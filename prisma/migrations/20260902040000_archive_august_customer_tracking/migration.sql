ALTER TABLE "LeadCustomer" ADD COLUMN "trackingArchivedAt" DATETIME;
ALTER TABLE "LeadCustomer" ADD COLUMN "trackingArchiveReason" TEXT;

CREATE INDEX "LeadCustomer_trackingArchivedAt_idx"
  ON "LeadCustomer"("trackingArchivedAt");

-- 与 PostgreSQL 正式迁移保持同一口径：8 月客户全部转为匿名历史底账。
-- 阶段日期与业务字段不动，所以历史汇总不变；真实号码被释放供 9 月重新录入。
CREATE TEMP TABLE "AugustCustomerPhoneArchive" AS
SELECT "id" AS "leadId", "phone" AS "originalPhone"
FROM "LeadCustomer"
WHERE "createdAt" >= '2026-08-01 00:00:00'
  AND "createdAt" < '2026-09-01 00:00:00';

UPDATE "LeadCustomer"
SET
  "trackingArchivedAt" = '2026-09-01 00:00:00',
  "trackingArchiveReason" = '2026-09-01 号码跟踪切换：8月号码全部清除，仅保留匿名统计底账',
  "phone" = 'ARCHIVED-AUG-LEAD-' || "id"
WHERE "id" IN (SELECT "leadId" FROM "AugustCustomerPhoneArchive");

UPDATE "CustomerOrder"
SET "phone" = 'ARCHIVED-AUG-ORDER-' || "id"
WHERE "leadId" IN (SELECT "leadId" FROM "AugustCustomerPhoneArchive");

UPDATE "LeadException"
SET "phone" = 'ARCHIVED-AUG-EXCEPTION-' || "id"
WHERE "phone" IN (SELECT "originalPhone" FROM "AugustCustomerPhoneArchive");

UPDATE "AuditLog"
SET "summary" = replace(
  "summary",
  (SELECT "originalPhone" FROM "AugustCustomerPhoneArchive"
   WHERE "AuditLog"."summary" LIKE '%' || "originalPhone" || '%' LIMIT 1),
  '[8月号码已清除]'
)
WHERE EXISTS (
  SELECT 1 FROM "AugustCustomerPhoneArchive"
  WHERE "AuditLog"."summary" LIKE '%' || "originalPhone" || '%'
);

UPDATE "DailyStatRevision"
SET "changeReason" = replace(
  "changeReason",
  (SELECT "originalPhone" FROM "AugustCustomerPhoneArchive"
   WHERE "DailyStatRevision"."changeReason" LIKE '%' || "originalPhone" || '%' LIMIT 1),
  '[8月号码已清除]'
)
WHERE EXISTS (
  SELECT 1 FROM "AugustCustomerPhoneArchive"
  WHERE "DailyStatRevision"."changeReason" LIKE '%' || "originalPhone" || '%'
);

DROP TABLE "AugustCustomerPhoneArchive";
