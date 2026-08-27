CREATE TYPE "DepositMethod" AS ENUM ('CRYPTO', 'BANK');

ALTER TABLE "LeadCustomer"
  ADD COLUMN "leftAutomatically" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CustomerOrder"
  ADD COLUMN "initialDepositMethod" "DepositMethod";

ALTER TABLE "MetricEvent"
  ADD COLUMN "depositMethod" "DepositMethod";
