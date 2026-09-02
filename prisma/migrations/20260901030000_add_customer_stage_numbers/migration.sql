ALTER TABLE "LeadCustomer" ADD COLUMN "groupQueueNumber" INTEGER;
ALTER TABLE "LeadCustomer" ADD COLUMN "groupQueueGroupId" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertQueueNumber" INTEGER;
ALTER TABLE "LeadCustomer" ADD COLUMN "expertQueueGroupId" TEXT;

CREATE TABLE "CustomerStageSequence" (
  "groupId" TEXT NOT NULL PRIMARY KEY,
  "lastGroupNumber" INTEGER NOT NULL DEFAULT 0,
  "lastExpertNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 旧客户按实际发生日期补固定编号；同一天再按创建时间和主键稳定排序。
WITH "RankedGroup" AS (
  SELECT
    lead."id",
    COALESCE(lead."currentGroupId", batch."groupId") AS "groupId",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(lead."currentGroupId", batch."groupId")
      ORDER BY lead."joinedOn" ASC, lead."createdAt" ASC, lead."id" ASC
    ) AS "queueNumber"
  FROM "LeadCustomer" lead
  JOIN "SourceBatch" batch ON batch."id" = lead."batchId"
  WHERE lead."joinedOn" IS NOT NULL
)
UPDATE "LeadCustomer"
SET
  "groupQueueGroupId" = (SELECT "groupId" FROM "RankedGroup" WHERE "RankedGroup"."id" = "LeadCustomer"."id"),
  "groupQueueNumber" = (SELECT "queueNumber" FROM "RankedGroup" WHERE "RankedGroup"."id" = "LeadCustomer"."id")
WHERE "id" IN (SELECT "id" FROM "RankedGroup");

WITH "RankedExpert" AS (
  SELECT
    lead."id",
    COALESCE(lead."currentGroupId", batch."groupId") AS "groupId",
    ROW_NUMBER() OVER (
      PARTITION BY COALESCE(lead."currentGroupId", batch."groupId")
      ORDER BY lead."expertIntroducedOn" ASC, lead."createdAt" ASC, lead."id" ASC
    ) AS "queueNumber"
  FROM "LeadCustomer" lead
  JOIN "SourceBatch" batch ON batch."id" = lead."batchId"
  WHERE lead."expertIntroducedOn" IS NOT NULL
)
UPDATE "LeadCustomer"
SET
  "expertQueueGroupId" = (SELECT "groupId" FROM "RankedExpert" WHERE "RankedExpert"."id" = "LeadCustomer"."id"),
  "expertQueueNumber" = (SELECT "queueNumber" FROM "RankedExpert" WHERE "RankedExpert"."id" = "LeadCustomer"."id")
WHERE "id" IN (SELECT "id" FROM "RankedExpert");

WITH "GroupIds" AS (
  SELECT "groupQueueGroupId" AS "groupId" FROM "LeadCustomer" WHERE "groupQueueGroupId" IS NOT NULL
  UNION
  SELECT "expertQueueGroupId" AS "groupId" FROM "LeadCustomer" WHERE "expertQueueGroupId" IS NOT NULL
)
INSERT INTO "CustomerStageSequence" ("groupId", "lastGroupNumber", "lastExpertNumber", "updatedAt")
SELECT
  ids."groupId",
  COALESCE((SELECT MAX(lead."groupQueueNumber") FROM "LeadCustomer" lead WHERE lead."groupQueueGroupId" = ids."groupId"), 0),
  COALESCE((SELECT MAX(lead."expertQueueNumber") FROM "LeadCustomer" lead WHERE lead."expertQueueGroupId" = ids."groupId"), 0),
  CURRENT_TIMESTAMP
FROM "GroupIds" ids;

CREATE UNIQUE INDEX "LeadCustomer_groupQueueGroupId_groupQueueNumber_key"
  ON "LeadCustomer"("groupQueueGroupId", "groupQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_expertQueueGroupId_expertQueueNumber_key"
  ON "LeadCustomer"("expertQueueGroupId", "expertQueueNumber");
