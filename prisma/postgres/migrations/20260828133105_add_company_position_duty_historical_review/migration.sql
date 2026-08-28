CREATE TYPE "Position" AS ENUM ('RECEPTION', 'GROUP_OPERATOR', 'EXPERT');
CREATE TYPE "Duty" AS ENUM ('LEAD', 'DEPARTMENT_MANAGER', 'COMPANY_MANAGER', 'HQ_MANAGER', 'RESOURCE_MANAGER', 'FINANCE');
CREATE TYPE "HistoricalReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'RETURNED');

ALTER TABLE "User" ADD COLUMN "duty" "Duty";

CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_name_key" ON "Company"("name");

ALTER TABLE "Department" ADD COLUMN "companyId" TEXT;

CREATE INDEX "Department_companyId_idx" ON "Department"("companyId");

ALTER TABLE "Department" ADD CONSTRAINT "Department_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "UserPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "groupId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "effectiveTo" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserPosition_userId_effectiveFrom_key" ON "UserPosition"("userId", "effectiveFrom");
CREATE INDEX "UserPosition_groupId_effectiveFrom_effectiveTo_idx" ON "UserPosition"("groupId", "effectiveFrom", "effectiveTo");
CREATE INDEX "UserPosition_userId_effectiveTo_idx" ON "UserPosition"("userId", "effectiveTo");

ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LeadCustomer" ADD COLUMN "historicalReviewStatus" "HistoricalReviewStatus";
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalReviewedById" TEXT;
ALTER TABLE "LeadCustomer" ADD COLUMN "historicalReviewedAt" TIMESTAMP(3);

CREATE INDEX "LeadCustomer_isHistoricalRecord_historicalReviewStatus_idx" ON "LeadCustomer"("isHistoricalRecord", "historicalReviewStatus");

ALTER TABLE "LeadCustomer" ADD CONSTRAINT "LeadCustomer_historicalReviewedById_fkey" FOREIGN KEY ("historicalReviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
