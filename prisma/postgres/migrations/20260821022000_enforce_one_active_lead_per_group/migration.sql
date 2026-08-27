DO $$
DECLARE
  conflict_group_id TEXT;
  conflict_user_ids TEXT;
BEGIN
  SELECT "groupId", string_agg("id", ', ' ORDER BY "id")
  INTO conflict_group_id, conflict_user_ids
  FROM "User"
  WHERE "role" = 'LEAD' AND "active" = true AND "groupId" IS NOT NULL
  GROUP BY "groupId"
  HAVING COUNT(*) > 1
  ORDER BY "groupId"
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION 'POSTGRES_ACTIVE_LEAD_CONFLICT: groupId % has multiple active LEAD users: %', conflict_group_id, conflict_user_ids;
  END IF;
END $$;

CREATE UNIQUE INDEX "User_one_active_lead_per_group"
ON "User"("groupId")
WHERE "role" = 'LEAD' AND "active" = true AND "groupId" IS NOT NULL;
