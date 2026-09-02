-- 当前业务不再经过资源部审批：把历史待确认记录的最新版设为正式版。
UPDATE "DailyStatEntry"
SET
  "approvedRevisionId" = "currentRevisionId",
  "status" = 'APPROVED',
  "reviewReason" = NULL,
  "reviewedById" = NULL,
  "reviewedAt" = NULL
WHERE "currentRevisionId" IS NOT NULL
  AND (
    "approvedRevisionId" IS NULL
    OR "approvedRevisionId" <> "currentRevisionId"
    OR "status" <> 'APPROVED'
  );
