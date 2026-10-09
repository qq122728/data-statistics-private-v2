CREATE TABLE "FinanceReconciliation" (
  "id" TEXT NOT NULL,
  "financeUserId" TEXT NOT NULL,
  "groupId" TEXT NOT NULL,
  "groupType" TEXT NOT NULL,
  "fromDate" TEXT NOT NULL,
  "toDate" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "note" TEXT,
  "sourceVersion" TEXT NOT NULL,
  "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FinanceReconciliation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FinanceReconciliation_scope_key" ON "FinanceReconciliation"("financeUserId", "groupId", "groupType", "fromDate", "toDate");
CREATE INDEX "FinanceReconciliation_financeUserId_fromDate_toDate_idx" ON "FinanceReconciliation"("financeUserId", "fromDate", "toDate");
CREATE INDEX "FinanceReconciliation_groupId_fromDate_toDate_idx" ON "FinanceReconciliation"("groupId", "fromDate", "toDate");
