-- 群生命周期与专家入金方式：历史资金保留 NULL，避免被错误归类。
ALTER TABLE "LeadCustomer" ADD COLUMN "leftAutomatically" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerOrder" ADD COLUMN "initialDepositMethod" TEXT;
ALTER TABLE "MetricEvent" ADD COLUMN "depositMethod" TEXT;
