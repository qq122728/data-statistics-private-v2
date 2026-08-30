-- Customer progress and daily statistics are independent ledgers. Copy every
-- existing customer finance fact first; keep the old MetricEvent rows intact
-- for rollback compatibility, but new code writes only this table.
CREATE TABLE "CustomerFinanceEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "customerOrderId" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "depositMethod" TEXT,
    "continuationNumber" INTEGER,
    "voidedAt" DATETIME,
    "voidReason" TEXT,
    "voidedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerFinanceEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerFinanceEvent_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CustomerFinanceEvent_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerFinanceEvent_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT OR IGNORE INTO "CustomerFinanceEvent" (
    "id", "batchId", "customerOrderId", "enteredById", "occurredOn", "kind",
    "amountCents", "depositMethod", "continuationNumber", "voidedAt", "voidReason",
    "voidedById", "createdAt"
)
SELECT
    "id", "batchId", "customerOrderId", "enteredById", "occurredOn", "kind",
    COALESCE("amountCents", 0), "depositMethod", "continuationNumber", "voidedAt", "voidReason",
    "voidedById", "createdAt"
FROM "MetricEvent"
WHERE "customerOrderId" IS NOT NULL
  AND "kind" IN ('RECHARGE', 'WITHDRAWAL');

CREATE UNIQUE INDEX "CustomerFinanceEvent_customerOrderId_continuationNumber_key"
ON "CustomerFinanceEvent"("customerOrderId", "continuationNumber");
CREATE INDEX "CustomerFinanceEvent_customerOrderId_occurredOn_idx"
ON "CustomerFinanceEvent"("customerOrderId", "occurredOn");
CREATE INDEX "CustomerFinanceEvent_enteredById_occurredOn_idx"
ON "CustomerFinanceEvent"("enteredById", "occurredOn");
CREATE INDEX "CustomerFinanceEvent_batchId_occurredOn_idx"
ON "CustomerFinanceEvent"("batchId", "occurredOn");
