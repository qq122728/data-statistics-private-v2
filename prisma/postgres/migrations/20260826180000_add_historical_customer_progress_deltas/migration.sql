ALTER TABLE "LeadCustomer" ADD COLUMN "historicalBaselineStage" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalReplyCounted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalJoinCounted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalLeaveCounted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalExpertIntroCounted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalRegistrationCounted" BOOLEAN NOT NULL DEFAULT false;
