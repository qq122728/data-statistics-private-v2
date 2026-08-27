import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/postgres-lead-constraint.test.ts", "tests/unit/postgres-deployment-safety.test.ts"],
    fileParallelism: false,
  },
});
