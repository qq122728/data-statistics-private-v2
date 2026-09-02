ALTER TABLE "LeadCustomer" ADD COLUMN "registrationQueueNumber" INTEGER;
ALTER TABLE "LeadCustomer" ADD COLUMN "registrationQueueGroupId" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "leaveQueueNumber" INTEGER;
ALTER TABLE "LeadCustomer" ADD COLUMN "leaveQueueGroupId" TEXT;
ALTER TABLE "CustomerOrder" ADD COLUMN "orderQueueNumber" INTEGER;
ALTER TABLE "CustomerOrder" ADD COLUMN "orderQueueGroupId" TEXT;

DROP INDEX IF EXISTS "LeadCustomer_groupQueueGroupId_groupQueueNumber_key";
DROP INDEX IF EXISTS "LeadCustomer_expertQueueGroupId_expertQueueNumber_key";

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "groupQueueGroupId", "joinedOn" ORDER BY "createdAt", id) AS n
  FROM "LeadCustomer" WHERE "groupQueueGroupId" IS NOT NULL AND "joinedOn" IS NOT NULL
)
UPDATE "LeadCustomer" SET "groupQueueNumber" = (SELECT n FROM ranked WHERE ranked.id = "LeadCustomer".id)
WHERE id IN (SELECT id FROM ranked);

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "expertQueueGroupId", "expertIntroducedOn" ORDER BY "createdAt", id) AS n
  FROM "LeadCustomer" WHERE "expertQueueGroupId" IS NOT NULL AND "expertIntroducedOn" IS NOT NULL
)
UPDATE "LeadCustomer" SET "expertQueueNumber" = (SELECT n FROM ranked WHERE ranked.id = "LeadCustomer".id)
WHERE id IN (SELECT id FROM ranked);

WITH ranked AS (
  SELECT lead.id, ROW_NUMBER() OVER (PARTITION BY COALESCE(lead."currentGroupId", batch."groupId"), lead."registeredOn" ORDER BY lead."createdAt", lead.id) AS n,
         COALESCE("currentGroupId", batch."groupId") AS group_id
  FROM "LeadCustomer" lead JOIN "SourceBatch" batch ON batch.id = lead."batchId"
  WHERE "registeredOn" IS NOT NULL
)
UPDATE "LeadCustomer" SET
  "registrationQueueNumber" = (SELECT n FROM ranked WHERE ranked.id = "LeadCustomer".id),
  "registrationQueueGroupId" = (SELECT group_id FROM ranked WHERE ranked.id = "LeadCustomer".id)
WHERE id IN (SELECT id FROM ranked);

WITH ranked AS (
  SELECT lead.id, ROW_NUMBER() OVER (PARTITION BY COALESCE(lead."currentGroupId", batch."groupId"), lead."leftOn" ORDER BY lead."createdAt", lead.id) AS n,
         COALESCE("currentGroupId", batch."groupId") AS group_id
  FROM "LeadCustomer" lead JOIN "SourceBatch" batch ON batch.id = lead."batchId"
  WHERE "leftOn" IS NOT NULL
)
UPDATE "LeadCustomer" SET
  "leaveQueueNumber" = (SELECT n FROM ranked WHERE ranked.id = "LeadCustomer".id),
  "leaveQueueGroupId" = (SELECT group_id FROM ranked WHERE ranked.id = "LeadCustomer".id)
WHERE id IN (SELECT id FROM ranked);

WITH ranked AS (
  SELECT orders.id AS id, ROW_NUMBER() OVER (PARTITION BY COALESCE(lead."currentGroupId", batch."groupId"), orders."openedOn" ORDER BY orders."createdAt", orders.id) AS n,
         COALESCE(lead."currentGroupId", batch."groupId") AS group_id
  FROM "CustomerOrder" orders
  JOIN "SourceBatch" batch ON batch.id = orders."batchId"
  LEFT JOIN "LeadCustomer" lead ON lead.id = orders."leadId"
)
UPDATE "CustomerOrder" SET
  "orderQueueNumber" = (SELECT n FROM ranked WHERE ranked.id = "CustomerOrder".id),
  "orderQueueGroupId" = (SELECT group_id FROM ranked WHERE ranked.id = "CustomerOrder".id)
WHERE id IN (SELECT id FROM ranked);

CREATE UNIQUE INDEX "LeadCustomer_groupQueueGroupId_joinedOn_groupQueueNumber_key" ON "LeadCustomer"("groupQueueGroupId", "joinedOn", "groupQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_expertQueueGroupId_expertIntroducedOn_expertQueueNumber_key" ON "LeadCustomer"("expertQueueGroupId", "expertIntroducedOn", "expertQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_registrationQueueGroupId_registeredOn_registrationQueueNumber_key" ON "LeadCustomer"("registrationQueueGroupId", "registeredOn", "registrationQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_leaveQueueGroupId_leftOn_leaveQueueNumber_key" ON "LeadCustomer"("leaveQueueGroupId", "leftOn", "leaveQueueNumber");
CREATE UNIQUE INDEX "CustomerOrder_orderQueueGroupId_openedOn_orderQueueNumber_key" ON "CustomerOrder"("orderQueueGroupId", "openedOn", "orderQueueNumber");

CREATE TABLE "CustomerDailyStageSequence" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredOn" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "CustomerDailyStageSequence_groupId_kind_occurredOn_key" ON "CustomerDailyStageSequence"("groupId", "kind", "occurredOn");

INSERT INTO "CustomerDailyStageSequence" (id, "groupId", kind, "occurredOn", "lastNumber", "updatedAt")
SELECT lower(hex(randomblob(16))), group_id, kind, occurred_on, MAX(n), CURRENT_TIMESTAMP FROM (
  SELECT "groupQueueGroupId" group_id, 'GROUP' kind, "joinedOn" occurred_on, "groupQueueNumber" n FROM "LeadCustomer" WHERE "groupQueueNumber" IS NOT NULL
  UNION ALL SELECT "expertQueueGroupId", 'EXPERT', "expertIntroducedOn", "expertQueueNumber" FROM "LeadCustomer" WHERE "expertQueueNumber" IS NOT NULL
  UNION ALL SELECT "registrationQueueGroupId", 'REGISTRATION', "registeredOn", "registrationQueueNumber" FROM "LeadCustomer" WHERE "registrationQueueNumber" IS NOT NULL
  UNION ALL SELECT "leaveQueueGroupId", 'LEAVE', "leftOn", "leaveQueueNumber" FROM "LeadCustomer" WHERE "leaveQueueNumber" IS NOT NULL
  UNION ALL SELECT "orderQueueGroupId", 'ORDER', "openedOn", "orderQueueNumber" FROM "CustomerOrder" WHERE "orderQueueNumber" IS NOT NULL
) GROUP BY group_id, kind, occurred_on;
