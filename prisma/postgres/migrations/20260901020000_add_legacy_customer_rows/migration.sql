CREATE TABLE "LegacyCustomerRow" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT NOT NULL,
    "joinedOn" TEXT,
    "phone" TEXT NOT NULL DEFAULT '',
    "attributionMemberName" TEXT NOT NULL DEFAULT '',
    "sourceChannelName" TEXT NOT NULL DEFAULT '',
    "groupOperatorName" TEXT NOT NULL DEFAULT '',
    "deviceCode" TEXT NOT NULL DEFAULT '',
    "groupSituation" TEXT NOT NULL DEFAULT '',
    "leaveType" TEXT NOT NULL DEFAULT '',
    "leftOn" TEXT,
    "expertName" TEXT NOT NULL DEFAULT '',
    "expertSituation" TEXT NOT NULL DEFAULT '',
    "registeredOn" TEXT,
    "initialDepositCents" INTEGER NOT NULL DEFAULT 0,
    "rechargeCents" INTEGER NOT NULL DEFAULT 0,
    "withdrawalCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LegacyCustomerRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LegacyCustomerRow_groupId_updatedAt_idx" ON "LegacyCustomerRow"("groupId", "updatedAt");
CREATE INDEX "LegacyCustomerRow_groupId_phone_idx" ON "LegacyCustomerRow"("groupId", "phone");
