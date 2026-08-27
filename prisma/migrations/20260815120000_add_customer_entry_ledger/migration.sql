CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "phone" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "openedOn" TEXT NOT NULL,
    "initialDepositCents" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CustomerOrder_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CustomerOrder_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "CustomerOrder_phone_key" ON "CustomerOrder"("phone");
CREATE INDEX "CustomerOrder_enteredById_openedOn_idx" ON "CustomerOrder"("enteredById", "openedOn");
CREATE INDEX "CustomerOrder_batchId_idx" ON "CustomerOrder"("batchId");

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MetricEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchId" TEXT NOT NULL,
    "enteredById" TEXT NOT NULL,
    "occurredOn" TEXT NOT NULL,
    "kind" TEXT NOT NULL CHECK ("kind" IN ('NEW_FANS', 'EFFECTIVE_FANS', 'NO_NUMBER', 'DUPLICATE_FANS', 'REPLIES', 'GROUP_JOIN', 'GROUP_LEAVE', 'EXPERT_INTRO', 'REGISTRATION', 'ORDER', 'RECHARGE', 'WITHDRAWAL', 'CHANNEL_PERFORMANCE')),
    "quantity" INTEGER,
    "amountCents" INTEGER,
    "parentEventId" TEXT,
    "customerOrderId" TEXT,
    "continuationNumber" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MetricEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "SourceBatch" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MetricEvent_enteredById_fkey" FOREIGN KEY ("enteredById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MetricEvent_parentEventId_fkey" FOREIGN KEY ("parentEventId") REFERENCES "MetricEvent" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MetricEvent_customerOrderId_fkey" FOREIGN KEY ("customerOrderId") REFERENCES "CustomerOrder" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_MetricEvent" ("amountCents", "batchId", "createdAt", "enteredById", "id", "kind", "occurredOn", "quantity")
SELECT "amountCents", "batchId", "createdAt", "enteredById", "id", "kind", "occurredOn", "quantity" FROM "MetricEvent";
DROP TABLE "MetricEvent";
ALTER TABLE "new_MetricEvent" RENAME TO "MetricEvent";
CREATE INDEX "MetricEvent_parentEventId_idx" ON "MetricEvent"("parentEventId");
CREATE INDEX "MetricEvent_customerOrderId_idx" ON "MetricEvent"("customerOrderId");
CREATE UNIQUE INDEX "MetricEvent_customerOrderId_continuationNumber_key" ON "MetricEvent"("customerOrderId", "continuationNumber");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
