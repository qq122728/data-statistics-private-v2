\set ON_ERROR_STOP on

-- 密码不得写在本文件或命令行中。见 runbook 的受保护交互式 \password 步骤。
DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'data_statistics_migrator') THEN
    CREATE ROLE data_statistics_migrator
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'data_statistics_runtime') THEN
    CREATE ROLE data_statistics_runtime
      NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$roles$;

ALTER ROLE data_statistics_migrator
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE data_statistics_runtime
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 即使角色以前被误建过，也移除它们继承或 SET ROLE 到其他角色的通道。
DO $memberships$
DECLARE
  membership record;
BEGIN
  FOR membership IN
    SELECT granted.rolname AS granted_role, member_role.rolname AS member_role
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname IN ('data_statistics_migrator', 'data_statistics_runtime')
       OR granted.rolname IN ('data_statistics_migrator', 'data_statistics_runtime')
  LOOP
    EXECUTE format('REVOKE %I FROM %I', membership.granted_role, membership.member_role);
  END LOOP;
END
$memberships$;

-- 此阶段保持 NOLOGIN；密码通过 runbook 中的交互式 \password 设置，避免进入命令历史和日志。
ALTER ROLE data_statistics_migrator NOLOGIN;
ALTER ROLE data_statistics_runtime NOLOGIN;
