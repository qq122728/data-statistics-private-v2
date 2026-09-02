-- 2026-09-01 是号码跟踪分界线。此前已进群的客户只保留匿名业务底账，
-- 9 月 1 日及以后进群的号码继续留在当前工作台。
CREATE TEMP TABLE "PreSeptemberJoinedPhoneArchive" AS
SELECT "id" AS "leadId", "phone" AS "originalPhone"
FROM "LeadCustomer"
WHERE "trackingArchivedAt" IS NULL
  AND "joinedOn" < '2026-09-01';

UPDATE "LeadCustomer"
SET
  "trackingArchivedAt" = CURRENT_TIMESTAMP,
  "trackingArchiveReason" = '2026-09-01号码跟踪切换：进群日期早于9月1日，仅保留匿名统计底账',
  "phone" = 'ARCHIVED-PRESEP-LEAD-' || "id"
WHERE "id" IN (SELECT "leadId" FROM "PreSeptemberJoinedPhoneArchive");

UPDATE "CustomerOrder"
SET "phone" = 'ARCHIVED-PRESEP-ORDER-' || "id"
WHERE "leadId" IN (SELECT "leadId" FROM "PreSeptemberJoinedPhoneArchive");

UPDATE "LeadException"
SET "phone" = 'ARCHIVED-PRESEP-EXCEPTION-' || "id"
WHERE "phone" IN (SELECT "originalPhone" FROM "PreSeptemberJoinedPhoneArchive");

UPDATE "AuditLog"
SET "summary" = replace(
  "summary",
  (SELECT "originalPhone" FROM "PreSeptemberJoinedPhoneArchive"
   WHERE "AuditLog"."summary" LIKE '%' || "originalPhone" || '%' LIMIT 1),
  '[9月前号码已清除]'
)
WHERE EXISTS (
  SELECT 1 FROM "PreSeptemberJoinedPhoneArchive"
  WHERE "AuditLog"."summary" LIKE '%' || "originalPhone" || '%'
);

UPDATE "DailyStatRevision"
SET "changeReason" = replace(
  "changeReason",
  (SELECT "originalPhone" FROM "PreSeptemberJoinedPhoneArchive"
   WHERE "DailyStatRevision"."changeReason" LIKE '%' || "originalPhone" || '%' LIMIT 1),
  '[9月前号码已清除]'
)
WHERE EXISTS (
  SELECT 1 FROM "PreSeptemberJoinedPhoneArchive"
  WHERE "DailyStatRevision"."changeReason" LIKE '%' || "originalPhone" || '%'
);

DROP TABLE "PreSeptemberJoinedPhoneArchive";
