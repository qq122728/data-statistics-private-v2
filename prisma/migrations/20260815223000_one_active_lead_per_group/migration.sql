CREATE UNIQUE INDEX "User_one_active_lead_per_group"
ON "User"("groupId")
WHERE "role" = 'LEAD' AND "active" = true AND "groupId" IS NOT NULL;
