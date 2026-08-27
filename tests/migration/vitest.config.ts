import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/sqlite-to-postgres-migration.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
