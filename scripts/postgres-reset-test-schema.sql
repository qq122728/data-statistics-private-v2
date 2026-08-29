-- 仅由 prepare-postgres-migration-test.mjs 在严格校验为固定本地测试库后执行。
DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;
