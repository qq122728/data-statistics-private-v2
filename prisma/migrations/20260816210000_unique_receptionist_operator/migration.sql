-- 历史数据如果曾把同一个接粉员分给多个炒群员，保留最早的一条归属。
DELETE FROM "GroupOperatorReception"
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM "GroupOperatorReception"
  GROUP BY "receptionistId"
);

DROP INDEX IF EXISTS "GroupOperatorReception_receptionistId_idx";
CREATE UNIQUE INDEX "GroupOperatorReception_receptionistId_key"
ON "GroupOperatorReception"("receptionistId");
