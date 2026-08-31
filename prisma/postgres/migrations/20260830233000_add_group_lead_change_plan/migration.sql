CREATE TABLE "GroupLeadChangePlan" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "formerLeadId" TEXT NOT NULL,
    "newLeadId" TEXT NOT NULL,
    "effectiveOn" TEXT NOT NULL,
    "formerDisposition" TEXT NOT NULL,
    "formerTargetGroupId" TEXT,
    "formerReceptionHandoffId" TEXT,
    "formerOperatorHandoffId" TEXT,
    "formerExpertHandoffId" TEXT,
    "newReceptionHandoffId" TEXT,
    "newOperatorHandoffId" TEXT,
    "newExpertHandoffId" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdById" TEXT NOT NULL,
    "appliedAt" TEXT,
    "cancelledAt" TEXT,
    "failureReason" TEXT,
    "createdAt" TEXT NOT NULL DEFAULT '',
    "updatedAt" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "GroupLeadChangePlan_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GroupLeadChangePlan_groupId_status_idx" ON "GroupLeadChangePlan"("groupId", "status");
CREATE INDEX "GroupLeadChangePlan_status_effectiveOn_idx" ON "GroupLeadChangePlan"("status", "effectiveOn");
