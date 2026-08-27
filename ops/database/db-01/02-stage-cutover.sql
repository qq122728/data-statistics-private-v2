\set ON_ERROR_STOP on

SELECT current_database() = 'data_statistics' AS expected_database \gset
\if :expected_database
\else
  \echo 'ERROR: this script only accepts the data_statistics database.'
  \quit 64
\endif

BEGIN;

-- 迁移账号拥有数据库对象；网站运行账号永远不是 owner。
REASSIGN OWNED BY data_statistics TO data_statistics_migrator;
REASSIGN OWNED BY data_statistics_runtime TO data_statistics_migrator;
ALTER DATABASE data_statistics OWNER TO data_statistics_migrator;
ALTER SCHEMA public OWNER TO data_statistics_migrator;
ALTER ROLE data_statistics
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;

-- 旧网站账号在过渡期也只能使用下面直接授予的 DML，不能借其他角色获得 DDL。
DO $legacy_memberships$
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
$legacy_memberships$;

REVOKE ALL ON DATABASE data_statistics FROM PUBLIC;
REVOKE ALL ON DATABASE data_statistics FROM data_statistics_runtime;
GRANT CONNECT ON DATABASE data_statistics TO data_statistics_runtime;
GRANT CONNECT, CREATE, TEMPORARY ON DATABASE data_statistics TO data_statistics_migrator;

-- REASSIGN OWNED 只转移 owner，不能依赖它清理历史显式 GRANT。
-- 旧网站账号必须先彻底清空，再在下方只授予过渡期 DML。
REVOKE ALL ON DATABASE data_statistics FROM data_statistics;

-- PostgreSQL 15+ 默认会给 PUBLIC 授予 public schema 的 USAGE。
-- 若只撤 CREATE，final 后的旧账号仍可通过 PUBLIC 解析和访问 schema。
REVOKE ALL ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA public FROM data_statistics_runtime;
REVOKE ALL ON SCHEMA public FROM data_statistics;
GRANT USAGE ON SCHEMA public TO data_statistics_runtime;
GRANT USAGE, CREATE ON SCHEMA public TO data_statistics_migrator;

REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM data_statistics_runtime;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM data_statistics;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO data_statistics_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM data_statistics_runtime;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM data_statistics;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO data_statistics_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM data_statistics_runtime;
REVOKE ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public FROM data_statistics;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

-- Prisma 迁移账本不是业务表：网站与旧账号都不得读写或伪造迁移状态。
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM data_statistics_runtime;
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM data_statistics;

-- 未来对象默认不授网站权限。每个新迁移必须显式为业务表/序列授权，
-- 避免新的迁移账本、审计表或运维表被网站自动获得 CRUD。
ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM data_statistics_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM data_statistics_runtime;
-- PostgreSQL 的函数 PUBLIC EXECUTE 是全局内建默认值；只写 IN SCHEMA 无法撤销它。
ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
-- 同时清理可能遗留的 public schema 显式默认授权。
ALTER DEFAULT PRIVILEGES FOR ROLE data_statistics_migrator IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- 切换 systemd 前临时保留旧网站连接的业务读写，但先拿掉建表权限。
GRANT CONNECT ON DATABASE data_statistics TO data_statistics;
GRANT USAGE ON SCHEMA public TO data_statistics;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO data_statistics;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO data_statistics;
REVOKE ALL PRIVILEGES ON TABLE public._prisma_migrations FROM data_statistics;

COMMIT;
