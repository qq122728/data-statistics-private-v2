-- Customer details collected while following up a phone lead.
ALTER TABLE "LeadCustomer" ADD COLUMN "customerName" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "lossAmountCents" INTEGER;
