-- Align legacy PostgreSQL metadata with the authoritative Prisma schema.
-- No customer or statistics values are changed.
ALTER TABLE "CustomerStageSequence" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER INDEX "LeadCustomer_expertQueueGroupId_expertIntroducedOn_expertQueueN"
RENAME TO "LeadCustomer_expertQueueGroupId_expertIntroducedOn_expertQu_key";
ALTER INDEX "LeadCustomer_registrationQueueGroupId_registeredOn_registration"
RENAME TO "LeadCustomer_registrationQueueGroupId_registeredOn_registra_key";
