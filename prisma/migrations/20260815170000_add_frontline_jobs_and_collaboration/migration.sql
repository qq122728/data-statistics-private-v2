ALTER TABLE User ADD COLUMN memberJob TEXT;

UPDATE User
SET memberJob = 'RECEPTION'
WHERE role = 'RECEPTION' AND memberJob IS NULL;

ALTER TABLE LeadCustomer ADD COLUMN expertOwnerId TEXT;

CREATE INDEX "LeadCustomer_expertOwnerId_idx" ON "LeadCustomer"("expertOwnerId");

CREATE TABLE "GroupOperatorReception" (
  "groupOperatorId" TEXT NOT NULL,
  "receptionistId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("groupOperatorId", "receptionistId"),
  CONSTRAINT "GroupOperatorReception_groupOperatorId_fkey" FOREIGN KEY ("groupOperatorId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "GroupOperatorReception_receptionistId_fkey" FOREIGN KEY ("receptionistId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GroupOperatorReception_receptionistId_idx" ON "GroupOperatorReception"("receptionistId");
