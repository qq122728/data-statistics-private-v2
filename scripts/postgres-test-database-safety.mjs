export const LOCAL_POSTGRES_TEST_DATABASE_URL =
  "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:55432/data_statistics_test?schema=public";
export const LOCAL_POSTGRES_SCHEMA_REFERENCE_DATABASE_URL =
  "postgresql://data_statistics_test:local_test_only_change_me@127.0.0.1:55433/data_statistics_test?schema=public";

function assertFixedLocalDatabaseUrl(value, expectedPort, variableName) {
  if (!value) {
    throw new Error(`${variableName} 未设置；只允许使用固定的本地 PostgreSQL 测试库`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${variableName} 不是合法 URL`);
  }

  const queryKeys = [...parsed.searchParams.keys()];
  const isFixedLocalTestDatabase =
    parsed.protocol === "postgresql:" &&
    parsed.hostname === "127.0.0.1" &&
    parsed.port === expectedPort &&
    parsed.pathname === "/data_statistics_test" &&
    decodeURIComponent(parsed.username) === "data_statistics_test" &&
    decodeURIComponent(parsed.password) === "local_test_only_change_me" &&
    queryKeys.length === 1 &&
    queryKeys[0] === "schema" &&
    parsed.searchParams.get("schema") === "public" &&
    parsed.hash === "";

  if (!isFixedLocalTestDatabase) {
    throw new Error(
      `为避免误操作，只允许固定本地测试库：127.0.0.1:${expectedPort}/data_statistics_test（public schema）`,
    );
  }

  return parsed.toString();
}

export function assertLocalPostgresTestDatabaseUrl(value) {
  return assertFixedLocalDatabaseUrl(value, "55432", "POSTGRES_TEST_DATABASE_URL");
}

export function assertLocalPostgresSchemaReferenceDatabaseUrl(value) {
  return assertFixedLocalDatabaseUrl(value, "55433", "POSTGRES_SCHEMA_REFERENCE_DATABASE_URL");
}
