\set ON_ERROR_STOP on

SELECT current_database() = 'data_statistics' AS expected_database \gset
\if :expected_database
\else
  \echo 'ERROR: this script only accepts the data_statistics database.'
  \quit 64
\endif

-- 紧急回滚会临时恢复旧账号的高权限。执行后必须重新完成 DB-01。
BEGIN;
ALTER ROLE data_statistics LOGIN;
REASSIGN OWNED BY data_statistics_migrator TO data_statistics;
ALTER DATABASE data_statistics OWNER TO data_statistics;
ALTER SCHEMA public OWNER TO data_statistics;
GRANT ALL PRIVILEGES ON DATABASE data_statistics TO data_statistics;
GRANT ALL PRIVILEGES ON SCHEMA public TO data_statistics;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO data_statistics;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO data_statistics;
COMMIT;
