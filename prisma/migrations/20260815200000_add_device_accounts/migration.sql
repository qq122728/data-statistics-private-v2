CREATE TABLE "DeviceAccount" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "groupId" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "accountNumber" TEXT NOT NULL,
  "renewalDate" TEXT,
  "purpose" TEXT,
  "situation" TEXT,
  "phoneCode" TEXT,
  "followUp" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "DeviceAccount_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "TeamGroup" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DeviceAccount_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DeviceAccount_groupId_accountNumber_key" ON "DeviceAccount"("groupId", "accountNumber");
CREATE INDEX "DeviceAccount_ownerId_updatedAt_idx" ON "DeviceAccount"("ownerId", "updatedAt");
CREATE INDEX "DeviceAccount_groupId_renewalDate_idx" ON "DeviceAccount"("groupId", "renewalDate");
