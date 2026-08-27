\set ON_ERROR_STOP on

SELECT current_database() = 'data_statistics' AS expected_database \gset
\if :expected_database
\else
  \echo 'ERROR: this script only accepts the data_statistics database.'
  \quit 64
\endif

BEGIN;

-- 仅在网站已经用 data_statistics_runtime 通过健康检查后执行。
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM data_statistics;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM data_statistics;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM data_statistics;
REVOKE ALL ON SCHEMA public FROM data_statistics;
REVOKE ALL ON DATABASE data_statistics FROM data_statistics;
ALTER ROLE data_statistics NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 清掉旧账号与其他角色之间的继承关系，避免通过 SET ROLE 绕回旧权限。
DO $memberships$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member_role.rolname AS member_role
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = 'data_statistics'
       OR granted.rolname = 'data_statistics'
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
$memberships$;

COMMIT;
