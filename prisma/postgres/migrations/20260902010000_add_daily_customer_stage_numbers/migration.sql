ALTER TABLE "LeadCustomer"
  ADD COLUMN "registrationQueueNumber" INTEGER,
  ADD COLUMN "registrationQueueGroupId" TEXT,
  ADD COLUMN "leaveQueueNumber" INTEGER,
  ADD COLUMN "leaveQueueGroupId" TEXT;
ALTER TABLE "CustomerOrder"
  ADD COLUMN "orderQueueNumber" INTEGER,
  ADD COLUMN "orderQueueGroupId" TEXT;

DROP INDEX IF EXISTS "LeadCustomer_groupQueueGroupId_groupQueueNumber_key";
DROP INDEX IF EXISTS "LeadCustomer_expertQueueGroupId_expertQueueNumber_key";

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "groupQueueGroupId", "joinedOn" ORDER BY "createdAt", id)::INTEGER AS n
  FROM "LeadCustomer" WHERE "groupQueueGroupId" IS NOT NULL AND "joinedOn" IS NOT NULL
)
UPDATE "LeadCustomer" lead SET "groupQueueNumber" = ranked.n FROM ranked WHERE ranked.id = lead.id;

WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "expertQueueGroupId", "expertIntroducedOn" ORDER BY "createdAt", id)::INTEGER AS n
  FROM "LeadCustomer" WHERE "expertQueueGroupId" IS NOT NULL AND "expertIntroducedOn" IS NOT NULL
)
UPDATE "LeadCustomer" lead SET "expertQueueNumber" = ranked.n FROM ranked WHERE ranked.id = lead.id;

WITH ranked AS (
  SELECT lead.id, COALESCE(lead."currentGroupId", batch."groupId") AS group_id,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(lead."currentGroupId", batch."groupId"), lead."registeredOn" ORDER BY lead."createdAt", lead.id)::INTEGER AS n
  FROM "LeadCustomer" lead JOIN "SourceBatch" batch ON batch.id = lead."batchId" WHERE lead."registeredOn" IS NOT NULL
)
UPDATE "LeadCustomer" lead SET "registrationQueueNumber" = ranked.n, "registrationQueueGroupId" = ranked.group_id FROM ranked WHERE ranked.id = lead.id;

WITH ranked AS (
  SELECT lead.id, COALESCE(lead."currentGroupId", batch."groupId") AS group_id,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(lead."currentGroupId", batch."groupId"), lead."leftOn" ORDER BY lead."createdAt", lead.id)::INTEGER AS n
  FROM "LeadCustomer" lead JOIN "SourceBatch" batch ON batch.id = lead."batchId" WHERE lead."leftOn" IS NOT NULL
)
UPDATE "LeadCustomer" lead SET "leaveQueueNumber" = ranked.n, "leaveQueueGroupId" = ranked.group_id FROM ranked WHERE ranked.id = lead.id;

WITH ranked AS (
  SELECT orders.id, COALESCE(lead."currentGroupId", batch."groupId") AS group_id,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(lead."currentGroupId", batch."groupId"), orders."openedOn" ORDER BY orders."createdAt", orders.id)::INTEGER AS n
  FROM "CustomerOrder" orders JOIN "SourceBatch" batch ON batch.id = orders."batchId" LEFT JOIN "LeadCustomer" lead ON lead.id = orders."leadId"
)
UPDATE "CustomerOrder" orders SET "orderQueueNumber" = ranked.n, "orderQueueGroupId" = ranked.group_id FROM ranked WHERE ranked.id = orders.id;

CREATE UNIQUE INDEX "LeadCustomer_groupQueueGroupId_joinedOn_groupQueueNumber_key" ON "LeadCustomer"("groupQueueGroupId", "joinedOn", "groupQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_expertQueueGroupId_expertIntroducedOn_expertQueueNumber_key" ON "LeadCustomer"("expertQueueGroupId", "expertIntroducedOn", "expertQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_registrationQueueGroupId_registeredOn_registrationQueueNumber_key" ON "LeadCustomer"("registrationQueueGroupId", "registeredOn", "registrationQueueNumber");
CREATE UNIQUE INDEX "LeadCustomer_leaveQueueGroupId_leftOn_leaveQueueNumber_key" ON "LeadCustomer"("leaveQueueGroupId", "leftOn", "leaveQueueNumber");
CREATE UNIQUE INDEX "CustomerOrder_orderQueueGroupId_openedOn_orderQueueNumber_key" ON "CustomerOrder"("orderQueueGroupId", "openedOn", "orderQueueNumber");

CREATE TABLE "CustomerDailyStageSequence" (
  "id" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "occurredOn" TEXT NOT NULL,
  "lastNumber" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CustomerDailyStageSequence_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CustomerDailyStageSequence_groupId_kind_occurredOn_key" ON "CustomerDailyStageSequence"("groupId", "kind", "occurredOn");

-- 线上网站使用受限运行账号；每日编号表需要原子读取和更新。
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
    WHERE c.oid = 'public."CustomerDailyStageSequence"'::regclass;

    SELECT
      has_table_privilege('data_statistics_runtime', 'public."CustomerDailyStageSequence"', 'SELECT')
      AND has_table_privilege('data_statistics_runtime', 'public."CustomerDailyStageSequence"', 'INSERT')
      AND has_table_privilege('data_statistics_runtime', 'public."CustomerDailyStageSequence"', 'UPDATE')
    INTO runtime_already_has_access;

    IF can_grant THEN
      GRANT SELECT, INSERT, UPDATE
        ON TABLE public."CustomerDailyStageSequence"
        TO data_statistics_runtime;
    ELSIF NOT runtime_already_has_access THEN
      RAISE EXCEPTION
        'migration role cannot grant CustomerDailyStageSequence privileges and runtime access is incomplete';
    END IF;
  END IF;
END
$grant_runtime$;

INSERT INTO "CustomerDailyStageSequence" (id, "groupId", kind, "occurredOn", "lastNumber", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || group_id || kind || occurred_on), group_id, kind, occurred_on, MAX(n), NOW() FROM (
  SELECT "groupQueueGroupId" group_id, 'GROUP' kind, "joinedOn" occurred_on, "groupQueueNumber" n FROM "LeadCustomer" WHERE "groupQueueNumber" IS NOT NULL
  UNION ALL SELECT "expertQueueGroupId", 'EXPERT', "expertIntroducedOn", "expertQueueNumber" FROM "LeadCustomer" WHERE "expertQueueNumber" IS NOT NULL
  UNION ALL SELECT "registrationQueueGroupId", 'REGISTRATION', "registeredOn", "registrationQueueNumber" FROM "LeadCustomer" WHERE "registrationQueueNumber" IS NOT NULL
  UNION ALL SELECT "leaveQueueGroupId", 'LEAVE', "leftOn", "leaveQueueNumber" FROM "LeadCustomer" WHERE "leaveQueueNumber" IS NOT NULL
  UNION ALL SELECT "orderQueueGroupId", 'ORDER', "openedOn", "orderQueueNumber" FROM "CustomerOrder" WHERE "orderQueueNumber" IS NOT NULL
) stages GROUP BY group_id, kind, occurred_on;
