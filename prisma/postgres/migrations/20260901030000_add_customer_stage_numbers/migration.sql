ALTER TABLE "LeadCustomer"
  ADD COLUMN "groupQueueNumber" INTEGER,
  ADD COLUMN "groupQueueGroupId" TEXT,
  ADD COLUMN "expertQueueNumber" INTEGER,
  ADD COLUMN "expertQueueGroupId" TEXT;

CREATE TABLE "CustomerStageSequence" (
  "groupId" TEXT NOT NULL PRIMARY KEY,
  "lastGroupNumber" INTEGER NOT NULL DEFAULT 0,
  "lastExpertNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 线上网站使用受限运行账号；新表只开放业务需要的读写权限。
DO $grant_runtime$
DECLARE
  can_grant boolean;
  runtime_already_has_access boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'data_statistics_runtime') THEN
    SELECT
      c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    INTO can_grant
    FROM pg_class c
    WHERE c.oid = 'public."CustomerStageSequence"'::regclass;

    SELECT
      has_table_privilege('data_statistics_runtime', 'public."CustomerStageSequence"', 'SELECT')
      AND has_table_privilege('data_statistics_runtime', 'public."CustomerStageSequence"', 'INSERT')
      AND has_table_privilege('data_statistics_runtime', 'public."CustomerStageSequence"', 'UPDATE')
    INTO runtime_already_has_access;

    IF can_grant THEN
      GRANT SELECT, INSERT, UPDATE
        ON TABLE public."CustomerStageSequence"
        TO data_statistics_runtime;
    ELSIF NOT runtime_already_has_access THEN
      RAISE EXCEPTION
        'migration role cannot grant CustomerStageSequence privileges and runtime access is incomplete';
    END IF;
  END IF;
END
$grant_runtime$;

-- 旧客户按实际发生日期补固定编号；同一天再按创建时间和主键稳定排序。
WITH "RankedGroup" AS (
  SELECT
    lead."id",
    COALESCE(lead."currentGroupId", batch."groupId") AS "groupId",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(lead."currentGroupId", batch."groupId")
      ORDER BY lead."joinedOn" ASC, lead."createdAt" ASC, lead."id" ASC
    )::INTEGER AS "queueNumber"
  FROM "LeadCustomer" lead
  JOIN "SourceBatch" batch ON batch."id" = lead."batchId"
  WHERE lead."joinedOn" IS NOT NULL
)
UPDATE "LeadCustomer" lead
SET
  "groupQueueGroupId" = ranked."groupId",
  "groupQueueNumber" = ranked."queueNumber"
FROM "RankedGroup" ranked
WHERE ranked."id" = lead."id";

WITH "RankedExpert" AS (
  SELECT
    lead."id",
    COALESCE(lead."currentGroupId", batch."groupId") AS "groupId",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(lead."currentGroupId", batch."groupId")
      ORDER BY lead."expertIntroducedOn" ASC, lead."createdAt" ASC, lead."id" ASC
    )::INTEGER AS "queueNumber"
  FROM "LeadCustomer" lead
  JOIN "SourceBatch" batch ON batch."id" = lead."batchId"
  WHERE lead."expertIntroducedOn" IS NOT NULL
)
UPDATE "LeadCustomer" lead
SET
  "expertQueueGroupId" = ranked."groupId",
  "expertQueueNumber" = ranked."queueNumber"
FROM "RankedExpert" ranked
WHERE ranked."id" = lead."id";

INSERT INTO "CustomerStageSequence" ("groupId", "lastGroupNumber", "lastExpertNumber", "updatedAt")
SELECT
  ids."groupId",
  COALESCE(MAX(lead."groupQueueNumber") FILTER (WHERE lead."groupQueueGroupId" = ids."groupId"), 0),
  COALESCE(MAX(lead."expertQueueNumber") FILTER (WHERE lead."expertQueueGroupId" = ids."groupId"), 0),
  CURRENT_TIMESTAMP
FROM (
  SELECT "groupQueueGroupId" AS "groupId" FROM "LeadCustomer" WHERE "groupQueueGroupId" IS NOT NULL
  UNION
  SELECT "expertQueueGroupId" AS "groupId" FROM "LeadCustomer" WHERE "expertQueueGroupId" IS NOT NULL
) ids
LEFT JOIN "LeadCustomer" lead
  ON lead."groupQueueGroupId" = ids."groupId" OR lead."expertQueueGroupId" = ids."groupId"
GROUP BY ids."groupId";

CREATE UNIQUE INDEX "LeadCustomer_groupQueueGroupId_groupQueueNumber_key"
  ON "LeadCustomer"("groupQueueGroupId", "groupQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_expertQueueGroupId_expertQueueNumber_key"
  ON "LeadCustomer"("expertQueueGroupId", "expertQueueNumber");
