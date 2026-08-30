-- New workflow: reception rows go directly to resource review; operator/expert rows
-- become official as soon as the employee saves them. Preserve every revision.
UPDATE "DailyStatEntry"
SET "status" = 'RESOURCE_PENDING',
    "submittedAt" = COALESCE("submittedAt", "updatedAt"),
    "reviewReason" = NULL,
    "reviewedById" = NULL,
    "reviewedAt" = NULL
WHERE "position" = 'RECEPTION'
  AND "currentRevisionId" IS NOT NULL
  AND "status" IN ('DRAFT', 'PENDING', 'CORRECTION_PENDING', 'RETURNED');

UPDATE "DailyStatEntry"
SET "status" = 'APPROVED',
    "approvedRevisionId" = "currentRevisionId",
    "submittedAt" = COALESCE("submittedAt", "updatedAt"),
    "reviewReason" = NULL,
    "reviewedById" = NULL,
    "reviewedAt" = NULL
WHERE "position" IN ('GROUP_OPERATOR', 'EXPERT')
  AND "currentRevisionId" IS NOT NULL
  AND "status" IN ('DRAFT', 'PENDING', 'CORRECTION_PENDING', 'RETURNED', 'RESOURCE_PENDING');
