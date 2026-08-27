ALTER TABLE "SourceBatch" ADD COLUMN "fanCostModeSnapshot" TEXT NOT NULL DEFAULT 'FREE';
ALTER TABLE "SourceBatch" ADD COLUMN "effectiveFanPriceCentsSnapshot" INTEGER;

UPDATE "SourceBatch"
SET
  "fanCostModeSnapshot" = COALESCE((
    SELECT "Channel"."fanCostMode"
    FROM "Channel"
    WHERE "Channel"."id" = "SourceBatch"."channelId"
      AND "Channel"."groupId" = "SourceBatch"."groupId"
  ), 'FREE'),
  "effectiveFanPriceCentsSnapshot" = (
    SELECT "Channel"."effectiveFanPriceCents"
    FROM "Channel"
    WHERE "Channel"."id" = "SourceBatch"."channelId"
      AND "Channel"."groupId" = "SourceBatch"."groupId"
  );

CREATE INDEX "SourceBatch_groupId_sourceDate_idx" ON "SourceBatch"("groupId", "sourceDate");
CREATE INDEX "MetricEvent_batchId_occurredOn_idx" ON "MetricEvent"("batchId", "occurredOn");
CREATE INDEX "MetricEvent_enteredById_occurredOn_idx" ON "MetricEvent"("enteredById", "occurredOn");
CREATE INDEX "MetricEvent_kind_occurredOn_idx" ON "MetricEvent"("kind", "occurredOn");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_createdAt_idx" ON "AuditLog"("entityType", "entityId", "createdAt");
CREATE INDEX "Session_userId_idx" ON "Session"("userId");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE UNIQUE INDEX "LeadCustomer_phone_key" ON "LeadCustomer"("phone");
CREATE INDEX "LeadCustomer_batchId_groupStatus_updatedAt_idx" ON "LeadCustomer"("batchId", "groupStatus", "updatedAt");
CREATE INDEX "LeadCustomer_expertOwnerId_updatedAt_idx" ON "LeadCustomer"("expertOwnerId", "updatedAt");
