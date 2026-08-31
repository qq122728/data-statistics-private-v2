-- DB-01 intentionally does not grant the website role access to every future table.
-- This plan table is application data, so grant only the four DML privileges the
-- runtime needs. Fresh installs may run this migration before DB-01 creates the
-- runtime role; the later DB-01 stage grant covers that order.
DO $grant_runtime$
DECLARE
  can_grant boolean;
  runtime_already_has_access boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'data_statistics_runtime') THEN
    SELECT
      c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)
      OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
    INTO can_grant
    FROM pg_class c
    WHERE c.oid = 'public."GroupLeadChangePlan"'::regclass;

    SELECT
      has_table_privilege('data_statistics_runtime', 'public."GroupLeadChangePlan"', 'SELECT')
      AND has_table_privilege('data_statistics_runtime', 'public."GroupLeadChangePlan"', 'INSERT')
      AND has_table_privilege('data_statistics_runtime', 'public."GroupLeadChangePlan"', 'UPDATE')
      AND has_table_privilege('data_statistics_runtime', 'public."GroupLeadChangePlan"', 'DELETE')
    INTO runtime_already_has_access;

    IF can_grant THEN
      GRANT SELECT, INSERT, UPDATE, DELETE
        ON TABLE public."GroupLeadChangePlan"
        TO data_statistics_runtime;
    ELSIF NOT runtime_already_has_access THEN
      RAISE EXCEPTION
        'migration role cannot grant GroupLeadChangePlan privileges and runtime access is incomplete';
    END IF;
  END IF;
END
$grant_runtime$;
