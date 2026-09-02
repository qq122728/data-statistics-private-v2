BEGIN;

ALTER TABLE "LeadCustomer"
  ADD COLUMN "trackingArchivedAt" TIMESTAMP(3),
  ADD COLUMN "trackingArchiveReason" TEXT;

CREATE INDEX "LeadCustomer_trackingArchivedAt_idx"
  ON "LeadCustomer"("trackingArchivedAt");

-- 2026-09-01 起按号码重新开始跟踪。8 月客户全部转为匿名历史底账：
-- 业务字段和阶段日期原样保留，因此历史汇总不变；真实号码从客户、开单、
-- 异常记录和可检索的操作说明中清除，原号码可以在 9 月作为新客户重新录入。
CREATE TEMP TABLE "AugustCustomerPhoneArchive" AS
SELECT "id" AS "leadId", "phone" AS "originalPhone"
FROM "LeadCustomer"
WHERE "createdAt" >= TIMESTAMP '2026-08-01 00:00:00'
  AND "createdAt" < TIMESTAMP '2026-09-01 00:00:00';

UPDATE "LeadCustomer" AS customer
SET
  "trackingArchivedAt" = TIMESTAMP '2026-09-01 00:00:00',
  "trackingArchiveReason" = '2026-09-01 号码跟踪切换：8月号码全部清除，仅保留匿名统计底账',
  "phone" = 'ARCHIVED-AUG-LEAD-' || customer."id"
FROM "AugustCustomerPhoneArchive" AS archived
WHERE customer."id" = archived."leadId";

UPDATE "CustomerOrder" AS customer_order
SET "phone" = 'ARCHIVED-AUG-ORDER-' || customer_order."id"
FROM "AugustCustomerPhoneArchive" AS archived
WHERE customer_order."leadId" = archived."leadId";

UPDATE "LeadException" AS exception
SET "phone" = 'ARCHIVED-AUG-EXCEPTION-' || exception."id"
FROM "AugustCustomerPhoneArchive" AS archived
WHERE exception."phone" = archived."originalPhone";

DO $$
DECLARE archived RECORD;
BEGIN
  FOR archived IN SELECT "originalPhone" FROM "AugustCustomerPhoneArchive" LOOP
    UPDATE "AuditLog"
    SET "summary" = replace("summary", archived."originalPhone", '[8月号码已清除]')
    WHERE "summary" LIKE '%' || archived."originalPhone" || '%';

    UPDATE "DailyStatRevision"
    SET "changeReason" = replace("changeReason", archived."originalPhone", '[8月号码已清除]')
    WHERE "changeReason" LIKE '%' || archived."originalPhone" || '%';
  END LOOP;
END $$;

DROP TABLE "AugustCustomerPhoneArchive";

COMMIT;
