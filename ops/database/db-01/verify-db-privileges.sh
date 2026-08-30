#!/usr/bin/env bash
set -euo pipefail

database_name="data_statistics"
phase=""
expected_migrations="${EXPECTED_MIGRATION_COUNT:-39}"

while (($# > 0)); do
  case "$1" in
    --phase)
      if (($# < 2)); then
        echo "ERROR: --phase requires stage or final." >&2
        exit 64
      fi
      phase="$2"
      shift 2
      ;;
    --*)
      echo "ERROR: unknown option: $1" >&2
      exit 64
      ;;
    *)
      database_name="$1"
      shift
      ;;
  esac
done

if [[ "$database_name" != "data_statistics" ]]; then
  echo "ERROR: verification only accepts the data_statistics database." >&2
  exit 64
fi
if [[ ! "$expected_migrations" =~ ^[0-9]+$ ]]; then
  echo "ERROR: EXPECTED_MIGRATION_COUNT must be a number." >&2
  exit 64
fi
if [[ "$phase" != "stage" && "$phase" != "final" ]]; then
  echo "ERROR: pass an explicit --phase stage or --phase final." >&2
  exit 64
fi
if [[ "$(id -un)" != "postgres" ]]; then
  echo "ERROR: run locally as the postgres OS account; do not pass a connection URL." >&2
  exit 77
fi

psql_admin=(psql --no-psqlrc --set ON_ERROR_STOP=1 --quiet --dbname "$database_name")

# 同一次验收的多个 psql 连接必须共用同一个探针名。名字只含安全字符，
# 并且在创建前确认不存在；清理函数只删除本次确认创建成功的对象。
probe_table="db01_privilege_probe_${$}_${RANDOM}_${RANDOM}"
forbidden_table="db01_runtime_forbidden_${$}_${RANDOM}_${RANDOM}"
probe_oid=""
probe_owner=""
forbidden_oid=""
forbidden_owner=""

if [[ ! "$probe_table" =~ ^[a-z0-9_]+$ || ! "$forbidden_table" =~ ^[a-z0-9_]+$ ]]; then
  echo "ERROR: generated an unsafe probe identifier." >&2
  exit 70
fi

cleanup_owned_probe() {
  local relation_name="$1"
  local expected_oid="$2"
  local expected_owner="$3"

  if [[ ! "$expected_oid" =~ ^[0-9]+$ || ! "$expected_owner" =~ ^[a-z0-9_]+$ ]]; then
    return
  fi

  # 先对当前同名关系加排他锁，再复核 OID 和 owner。若原表已被替换，绝不删新表。
  "${psql_admin[@]}" >/dev/null 2>&1 <<SQL
DO \$cleanup\$
DECLARE
  current_oid oid;
BEGIN
  current_oid := to_regclass('public.${relation_name}');
  IF current_oid IS NULL OR current_oid <> ${expected_oid}::oid THEN
    RETURN;
  END IF;

  BEGIN
    EXECUTE format('LOCK TABLE %I.%I IN ACCESS EXCLUSIVE MODE', 'public', '${relation_name}');
  EXCEPTION WHEN undefined_table THEN
    RETURN;
  END;

  current_oid := to_regclass('public.${relation_name}');
  IF current_oid = ${expected_oid}::oid AND EXISTS (
    SELECT 1
    FROM pg_class c
    WHERE c.oid = current_oid
      AND pg_get_userbyid(c.relowner) = '${expected_owner}'
  ) THEN
    EXECUTE format('DROP TABLE %I.%I', 'public', '${relation_name}');
  END IF;
END
\$cleanup\$;
SQL
}

cleanup() {
  cleanup_owned_probe "$forbidden_table" "$forbidden_oid" "$forbidden_owner" || true
  cleanup_owned_probe "$probe_table" "$probe_oid" "$probe_owner" || true
}
trap cleanup EXIT

collision_count="$("${psql_admin[@]}" --tuples-only --no-align --command \
  "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('${probe_table}', '${forbidden_table}')")"
if [[ "$collision_count" != "0" ]]; then
  echo "ERROR: a generated probe name already exists; no object was changed." >&2
  exit 1
fi

echo "[1/6] checking role, ownership, and effective privileges"
"${psql_admin[@]}" <<'SQL'
DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'data_statistics_runtime'
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'runtime role attributes are unsafe';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'data_statistics_migrator'
      AND rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'migration role attributes are unsafe';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'S')
      AND pg_get_userbyid(c.relowner) <> 'data_statistics_migrator'
  ) THEN
    RAISE EXCEPTION 'a public table or sequence is not owned by the migrator';
  END IF;
  IF pg_get_userbyid((SELECT datdba FROM pg_database WHERE datname = current_database())) <>
       'data_statistics_migrator' OR
     pg_get_userbyid((SELECT nspowner FROM pg_namespace WHERE nspname = 'public')) <>
       'data_statistics_migrator' THEN
    RAISE EXCEPTION 'database or public schema is not owned by the migrator';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(c.relowner) = 'data_statistics_runtime'
  ) OR EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(t.typowner) = 'data_statistics_runtime'
  ) OR EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND pg_get_userbyid(p.proowner) = 'data_statistics_runtime'
  ) THEN
    RAISE EXCEPTION 'runtime role owns an object in public';
  END IF;
  IF has_schema_privilege('data_statistics_runtime', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'runtime role can create objects in public';
  END IF;
  -- PUBLIC 不是可传给 has_*_privilege 的真实角色；直接检查 ACL 中 grantee=0。
  IF EXISTS (
    SELECT 1
    FROM pg_namespace n
    CROSS JOIN LATERAL aclexplode(COALESCE(n.nspacl, acldefault('n', n.nspowner))) a
    WHERE n.nspname = 'public'
      AND a.grantee = 0
      AND a.privilege_type IN ('USAGE', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'PUBLIC still has access to the public schema';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_database d
    CROSS JOIN LATERAL aclexplode(COALESCE(d.datacl, acldefault('d', d.datdba))) a
    WHERE d.datname = current_database()
      AND a.grantee = 0
      AND a.privilege_type IN ('CONNECT', 'CREATE', 'TEMPORARY')
  ) THEN
    RAISE EXCEPTION 'PUBLIC still has database privileges';
  END IF;
  IF has_database_privilege('data_statistics_runtime', current_database(), 'CREATE') OR
     has_database_privilege('data_statistics_runtime', current_database(), 'TEMPORARY') THEN
    RAISE EXCEPTION 'runtime role has forbidden database privileges';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname IN ('data_statistics_runtime', 'data_statistics_migrator')
       OR granted.rolname IN ('data_statistics_runtime', 'data_statistics_migrator')
  ) THEN
    RAISE EXCEPTION 'runtime or migrator role has a role membership';
  END IF;

  -- 每个业务表必须同时具备四项 DML，不能用“任意一项成功”冒充全部。
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
      AND (
        NOT has_table_privilege('data_statistics_runtime', format('%I.%I', table_schema, table_name), 'SELECT') OR
        NOT has_table_privilege('data_statistics_runtime', format('%I.%I', table_schema, table_name), 'INSERT') OR
        NOT has_table_privilege('data_statistics_runtime', format('%I.%I', table_schema, table_name), 'UPDATE') OR
        NOT has_table_privilege('data_statistics_runtime', format('%I.%I', table_schema, table_name), 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'runtime role is missing a required DML privilege';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public'
      AND has_table_privilege(
        'data_statistics_runtime',
        format('%I.%I', table_schema, table_name),
        'TRUNCATE,TRIGGER,REFERENCES'
      )
  ) THEN
    RAISE EXCEPTION 'runtime role has forbidden table privileges';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.sequences
    WHERE sequence_schema = 'public'
      AND (
        NOT has_sequence_privilege('data_statistics_runtime', format('%I.%I', sequence_schema, sequence_name), 'USAGE') OR
        NOT has_sequence_privilege('data_statistics_runtime', format('%I.%I', sequence_schema, sequence_name), 'SELECT')
      )
  ) THEN
    RAISE EXCEPTION 'runtime role is missing a required sequence privilege';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.sequences
    WHERE sequence_schema = 'public'
      AND has_sequence_privilege(
        'data_statistics_runtime',
        format('%I.%I', sequence_schema, sequence_name),
        'UPDATE'
      )
  ) THEN
    RAISE EXCEPTION 'runtime role can alter sequence values';
  END IF;

  IF to_regclass('public._prisma_migrations') IS NULL THEN
    RAISE EXCEPTION 'Prisma migration history table is missing';
  END IF;
  IF has_table_privilege('data_statistics_runtime', 'public._prisma_migrations', 'SELECT') OR
     has_table_privilege('data_statistics_runtime', 'public._prisma_migrations', 'INSERT') OR
     has_table_privilege('data_statistics_runtime', 'public._prisma_migrations', 'UPDATE') OR
     has_table_privilege('data_statistics_runtime', 'public._prisma_migrations', 'DELETE') OR
     has_table_privilege('data_statistics', 'public._prisma_migrations', 'SELECT') OR
     has_table_privilege('data_statistics', 'public._prisma_migrations', 'INSERT') OR
     has_table_privilege('data_statistics', 'public._prisma_migrations', 'UPDATE') OR
     has_table_privilege('data_statistics', 'public._prisma_migrations', 'DELETE') THEN
    RAISE EXCEPTION 'website or legacy role can access Prisma migration history';
  END IF;

  -- 默认 ACL 不得把任何未来对象自动授给运行账号。
  IF EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'data_statistics_migrator')
      AND d.defaclnamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
      AND a.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'data_statistics_runtime')
  ) THEN
    RAISE EXCEPTION 'future migrator objects are automatically granted to runtime';
  END IF;

  -- 函数默认给 PUBLIC EXECUTE，必须存在迁移账号的全局撤销记录，
  -- 且不得有任何全局或 schema 级的 PUBLIC EXECUTE 显式授权。
  IF NOT EXISTS (
    SELECT 1
    FROM pg_default_acl d
    WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'data_statistics_migrator')
      AND d.defaclnamespace = 0
      AND d.defaclobjtype = 'f'
  ) OR EXISTS (
    SELECT 1
    FROM pg_default_acl d
    CROSS JOIN LATERAL aclexplode(d.defaclacl) a
    WHERE d.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'data_statistics_migrator')
      AND d.defaclobjtype = 'f'
      AND a.grantee = 0
      AND a.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'future migrator functions are executable by PUBLIC';
  END IF;
END
$verify$;
SQL

if [[ "$phase" == "stage" ]]; then
  echo "      checking transitional legacy-account access"
  "${psql_admin[@]}" <<'SQL'
DO $stage$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'data_statistics' AND rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'legacy role is not in the expected transitional state';
  END IF;
  IF NOT has_database_privilege('data_statistics', current_database(), 'CONNECT') OR
     NOT has_schema_privilege('data_statistics', 'public', 'USAGE') OR
     has_schema_privilege('data_statistics', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'legacy role has incorrect transitional database or schema access';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name <> '_prisma_migrations'
      AND (
        NOT has_table_privilege('data_statistics', format('%I.%I', table_schema, table_name), 'SELECT') OR
        NOT has_table_privilege('data_statistics', format('%I.%I', table_schema, table_name), 'INSERT') OR
        NOT has_table_privilege('data_statistics', format('%I.%I', table_schema, table_name), 'UPDATE') OR
        NOT has_table_privilege('data_statistics', format('%I.%I', table_schema, table_name), 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'legacy role is missing transitional business DML';
  END IF;
END
$stage$;
SQL
else
  echo "      checking finalized legacy-account removal"
  "${psql_admin[@]}" <<'SQL'
DO $final$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = 'data_statistics' AND NOT rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole
      AND NOT rolreplication AND NOT rolbypassrls
  ) THEN
    RAISE EXCEPTION 'legacy role is not safely disabled';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_auth_members m
    JOIN pg_roles granted ON granted.oid = m.roleid
    JOIN pg_roles member_role ON member_role.oid = m.member
    WHERE member_role.rolname = 'data_statistics'
       OR granted.rolname = 'data_statistics'
  ) THEN
    RAISE EXCEPTION 'legacy role still has a role membership';
  END IF;
  IF has_database_privilege('data_statistics', current_database(), 'CONNECT') OR
     has_database_privilege('data_statistics', current_database(), 'CREATE') OR
     has_database_privilege('data_statistics', current_database(), 'TEMPORARY') OR
     has_schema_privilege('data_statistics', 'public', 'USAGE') OR
     has_schema_privilege('data_statistics', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'legacy role still has database or schema privileges';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND (
        pg_get_userbyid(c.relowner) = 'data_statistics' OR
        (c.relkind IN ('r', 'p', 'v', 'm', 'f') AND
          has_table_privilege('data_statistics', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) OR
        (c.relkind = 'S' AND
          has_sequence_privilege('data_statistics', c.oid, 'USAGE,SELECT,UPDATE'))
      )
  ) THEN
    RAISE EXCEPTION 'legacy role still owns or can access a public relation';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (pg_get_userbyid(p.proowner) = 'data_statistics' OR
           has_function_privilege('data_statistics', p.oid, 'EXECUTE'))
  ) THEN
    RAISE EXCEPTION 'legacy role still owns or can execute a public function';
  END IF;
END
$final$;
SQL
fi

echo "[2/6] checking all recorded Prisma migrations"
migration_result="$("${psql_admin[@]}" --tuples-only --no-align --command \
  "SELECT count(*) || '|' || count(*) FILTER (WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL) FROM public._prisma_migrations")"
if [[ "$migration_result" != "${expected_migrations}|${expected_migrations}" ]]; then
  echo "ERROR: expected ${expected_migrations} successful migrations; got ${migration_result}." >&2
  exit 1
fi

echo "[3/6] checking migrator CREATE/ALTER/DROP and explicit business grants"
probe_identity="$("${psql_admin[@]}" --tuples-only --no-align <<SQL
SET ROLE data_statistics_migrator;
CREATE TABLE public.${probe_table} (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  note text NOT NULL
);
RESET ROLE;
SELECT c.oid || '|' || pg_get_userbyid(c.relowner)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = '${probe_table}';
SQL
)"
IFS='|' read -r probe_oid probe_owner <<<"$probe_identity"
if [[ ! "$probe_oid" =~ ^[0-9]+$ || "$probe_owner" != "data_statistics_migrator" ]]; then
  echo "ERROR: could not record the migrator probe identity safely." >&2
  exit 1
fi

"${psql_admin[@]}" <<SQL
SET ROLE data_statistics_migrator;
ALTER TABLE public.${probe_table} ADD COLUMN checked boolean NOT NULL DEFAULT false;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.${probe_table} TO data_statistics_runtime;
GRANT USAGE, SELECT ON SEQUENCE public.${probe_table}_id_seq TO data_statistics_runtime;
SQL

echo "[4/6] checking runtime SELECT/INSERT/UPDATE/DELETE and sequence use"
"${psql_admin[@]}" <<SQL
BEGIN;
SET LOCAL ROLE data_statistics_runtime;
INSERT INTO public.${probe_table} (note) VALUES ('db01-verification');
SELECT id, note FROM public.${probe_table} WHERE note = 'db01-verification';
UPDATE public.${probe_table} SET checked = true WHERE note = 'db01-verification';
DELETE FROM public.${probe_table} WHERE note = 'db01-verification';
ROLLBACK;
SQL

expect_denied() {
  local label="$1"
  local statement="$2"
  local denied_output

  if denied_output="$("${psql_admin[@]}" --set VERBOSITY=verbose \
      --command "SET ROLE data_statistics_runtime; ${statement}" 2>&1)"; then
    echo "ERROR: runtime role unexpectedly succeeded at ${label}." >&2
    exit 1
  fi

  # VERBOSITY=verbose 把 SQLSTATE 放入错误行；只有 42501 才是真正的权限拒绝。
  if ! grep -Eq 'ERROR:[[:space:]]+42501:' <<<"$denied_output"; then
    echo "ERROR: ${label} failed for a reason other than SQLSTATE 42501 insufficient_privilege." >&2
    exit 1
  fi
  echo "  denied with SQLSTATE 42501: ${label}"
}

expect_create_denied() {
  local denied_output
  local forbidden_identity

  if denied_output="$("${psql_admin[@]}" --set VERBOSITY=verbose \
      --command "SET ROLE data_statistics_runtime; CREATE TABLE public.${forbidden_table} (id bigint)" 2>&1)"; then
    forbidden_identity="$("${psql_admin[@]}" --tuples-only --no-align --command \
      "SELECT c.oid || '|' || pg_get_userbyid(c.relowner) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname = '${forbidden_table}'")"
    IFS='|' read -r forbidden_oid forbidden_owner <<<"$forbidden_identity"
    echo "ERROR: runtime role unexpectedly succeeded at CREATE TABLE." >&2
    exit 1
  fi
  if ! grep -Eq 'ERROR:[[:space:]]+42501:' <<<"$denied_output"; then
    echo "ERROR: CREATE TABLE failed for a reason other than SQLSTATE 42501 insufficient_privilege." >&2
    exit 1
  fi
  echo "  denied with SQLSTATE 42501: CREATE TABLE"
}

echo "[5/6] checking runtime CREATE/ALTER/TRUNCATE/DROP are denied"
expect_create_denied
expect_denied "ALTER TABLE" "ALTER TABLE public.${probe_table} ADD COLUMN forbidden text"
expect_denied "TRUNCATE TABLE" "TRUNCATE TABLE public.${probe_table}"
expect_denied "DROP TABLE" "DROP TABLE public.${probe_table}"

echo "[6/6] removing only this run's migrator-owned verification table"
cleanup_owned_probe "$probe_table" "$probe_oid" "$probe_owner"
if [[ "$("${psql_admin[@]}" --tuples-only --no-align --command "SELECT to_regclass('public.${probe_table}') IS NULL")" != "t" ]]; then
  echo "ERROR: the verification probe was not removed; no different object was deleted." >&2
  exit 1
fi
probe_oid=""
probe_owner=""
trap - EXIT

echo "PASS: DB-01 runtime and migration privileges are separated."
