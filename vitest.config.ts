import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/unit/global-setup.ts"],
    // Database-backed unit files share one disposable SQLite database.
    // Running those files concurrently can leak temporary settings between tests.
    fileParallelism: false,
    // Prisma 6's macOS schema engine can fail without details while preparing
    // isolated SQLite files. Its diagnostic mode keeps that engine stable and
    // applies only to test-owned databases.
    env: {
      RUST_BACKTRACE: "1",
      RUST_LOG: "trace",
    },
  },
});
