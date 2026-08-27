#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MIGRATION_DATABASE_URL:-}" ]]; then
  echo "ERROR: MIGRATION_DATABASE_URL is required for PostgreSQL migrations." >&2
  echo "Do not reuse the website runtime DATABASE_URL for migrations." >&2
  exit 64
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "ERROR: DATABASE_URL is required to verify the separate runtime account." >&2
  exit 64
fi

# 只验证账号和目标是否分离，绝不输出连接串。
node <<'NODE'
const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(64);
};

let runtime;
let migrator;
try {
  runtime = new URL(process.env.DATABASE_URL);
  migrator = new URL(process.env.MIGRATION_DATABASE_URL);
} catch {
  fail("DATABASE_URL and MIGRATION_DATABASE_URL must be valid PostgreSQL URLs.");
}

if (!["postgres:", "postgresql:"].includes(runtime.protocol) ||
    !["postgres:", "postgresql:"].includes(migrator.protocol)) {
  fail("database URLs must use PostgreSQL.");
}
if (decodeURIComponent(runtime.username) !== "data_statistics_runtime") {
  fail("DATABASE_URL must use the data_statistics_runtime account.");
}
if (decodeURIComponent(migrator.username) !== "data_statistics_migrator") {
  fail("MIGRATION_DATABASE_URL must use the data_statistics_migrator account.");
}
if (runtime.hostname !== migrator.hostname ||
    (runtime.port || "5432") !== (migrator.port || "5432") ||
    runtime.pathname !== migrator.pathname ||
    (runtime.searchParams.get("schema") || "public") !==
      (migrator.searchParams.get("schema") || "public")) {
  fail("runtime and migration accounts must target the same database.");
}
NODE

export DATABASE_URL="$MIGRATION_DATABASE_URL"
unset MIGRATION_DATABASE_URL
exec prisma migrate deploy --schema prisma/postgres/schema.prisma
