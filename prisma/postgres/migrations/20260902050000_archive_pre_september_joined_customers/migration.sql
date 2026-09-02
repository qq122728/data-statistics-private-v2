BEGIN;

-- 2026-09-01 是号码跟踪分界线。此前已进群的客户只保留匿名业务底账，
-- 9 月 1 日及以后进群的号码继续留在当前工作台。
CREATE TEMP TABLE "PreSeptemberJoinedPhoneArchive" AS
SELECT "id" AS "leadId", "phone" AS "originalPhone"
FROM "LeadCustomer"
WHERE "trackingArchivedAt" IS NULL
  AND "joinedOn" < '2026-09-01';

UPDATE "LeadCustomer" AS customer
SET
  "trackingArchivedAt" = CURRENT_TIMESTAMP,
  "trackingArchiveReason" = '2026-09-01号码跟踪切换：进群日期早于9月1日，仅保留匿名统计底账',
  "phone" = 'ARCHIVED-PRESEP-LEAD-' || customer."id"
FROM "PreSeptemberJoinedPhoneArchive" AS archived
WHERE customer."id" = archived."leadId";

UPDATE "CustomerOrder" AS customer_order
SET "phone" = 'ARCHIVED-PRESEP-ORDER-' || customer_order."id"
FROM "PreSeptemberJoinedPhoneArchive" AS archived
WHERE customer_order."leadId" = archived."leadId";

UPDATE "LeadException" AS exception
SET "phone" = 'ARCHIVED-PRESEP-EXCEPTION-' || exception."id"
FROM "PreSeptemberJoinedPhoneArchive" AS archived
WHERE exception."phone" = archived."originalPhone";

DO $$
DECLARE archived RECORD;
BEGIN
  FOR archived IN SELECT "originalPhone" FROM "PreSeptemberJoinedPhoneArchive" LOOP
    UPDATE "AuditLog"
    SET "summary" = replace("summary", archived."originalPhone", '[9月前号码已清除]')
    WHERE "summary" LIKE '%' || archived."originalPhone" || '%';

    UPDATE "DailyStatRevision"
    SET "changeReason" = replace("changeReason", archived."originalPhone", '[9月前号码已清除]')
    WHERE "changeReason" LIKE '%' || archived."originalPhone" || '%';
  END LOOP;
END $$;

DROP TABLE "PreSeptemberJoinedPhoneArchive";

COMMIT;
