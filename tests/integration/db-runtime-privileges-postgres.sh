#!/usr/bin/env bash
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "SKIP: Docker is required for the DB-01 PostgreSQL integration test." >&2
  exit 77
fi

container_name="db01-postgres-${$}-${RANDOM}"
expected_migrations="${EXPECTED_MIGRATION_COUNT:-39}"

cleanup() {
  docker rm --force "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --detach --name "$container_name" \
  --env POSTGRES_DB=data_statistics \
  --env POSTGRES_USER=postgres \
  --env POSTGRES_PASSWORD=admin_test_only \
  --publish 127.0.0.1::5432 \
  postgres:17 >/dev/null

ready=false
for _ in $(seq 1 60); do
  # pg_isready only proves that PostgreSQL accepts connections; during first
  # initialization it can succeed before POSTGRES_DB has been created.
  if docker exec "$container_name" pg_isready --username postgres --dbname postgres >/dev/null 2>&1 &&
     [[ "$(docker exec --user postgres "$container_name" \
       psql --no-psqlrc --tuples-only --no-align --dbname postgres \
       --command "SELECT 1 FROM pg_database WHERE datname = 'data_statistics'" 2>/dev/null)" == "1" ]]; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "ERROR: PostgreSQL test container did not become ready." >&2
  exit 1
fi

host_port="$(docker port "$container_name" 5432/tcp | awk -F: 'NR == 1 { print $NF }')"
if [[ ! "$host_port" =~ ^[0-9]+$ ]]; then
  echo "ERROR: could not determine the PostgreSQL test port." >&2
  exit 1
fi

# 先模拟生产现状：旧网站账号同时拥有数据库、schema 和迁移创建的对象。
docker exec --user postgres --interactive "$container_name" \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics <<'SQL'
CREATE ROLE data_statistics LOGIN PASSWORD 'legacy_test_only'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER DATABASE data_statistics OWNER TO data_statistics;
ALTER SCHEMA public OWNER TO data_statistics;
SQL

legacy_url="postgresql://data_statistics:legacy_test_only@127.0.0.1:${host_port}/data_statistics?schema=public"
runtime_url="postgresql://data_statistics_runtime:runtime_test_only@127.0.0.1:${host_port}/data_statistics?schema=public"
migrator_url="postgresql://data_statistics_migrator:migrator_test_only@127.0.0.1:${host_port}/data_statistics?schema=public"

DATABASE_URL="$legacy_url" npx prisma migrate deploy --schema prisma/postgres/schema.prisma

docker exec "$container_name" mkdir --parents /tmp/db01
docker cp ops/database/db-01/. "${container_name}:/tmp/db01/"

docker exec --user postgres "$container_name" \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics \
  --file /tmp/db01/01-create-roles.sql
docker exec --user postgres --interactive "$container_name" \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics <<'SQL'
ALTER ROLE data_statistics_runtime LOGIN PASSWORD 'runtime_test_only';
ALTER ROLE data_statistics_migrator LOGIN PASSWORD 'migrator_test_only';
SQL
docker exec --user postgres "$container_name" \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics \
  --file /tmp/db01/02-stage-cutover.sql

docker exec --user postgres --env EXPECTED_MIGRATION_COUNT="$expected_migrations" "$container_name" \
  bash /tmp/db01/verify-db-privileges.sh data_statistics --phase stage

# 真实运行发布入口，确认只有 migrator 连接能执行 Prisma 迁移。
PATH="$(pwd)/node_modules/.bin:${PATH}" \
  DATABASE_URL="$runtime_url" MIGRATION_DATABASE_URL="$migrator_url" \
  npm run db:migrate:postgres

docker exec --user postgres "$container_name" \
  psql --no-psqlrc --set ON_ERROR_STOP=1 --dbname data_statistics \
  --file /tmp/db01/03-finalize-cutover.sql
docker exec --user postgres --env EXPECTED_MIGRATION_COUNT="$expected_migrations" "$container_name" \
  bash /tmp/db01/verify-db-privileges.sh data_statistics --phase final

echo "PASS: DB-01 completed a real PostgreSQL migration and least-privilege cutover."
