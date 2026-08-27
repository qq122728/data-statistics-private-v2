import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  // The browser tests intentionally create and deactivate data. SQLite keeps
  // one file per test server, so running files in parallel makes them affect
  // one another instead of testing independent workflows.
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3011", channel: "chrome" },
  webServer: {
    command: "exec env E2E_PORT=3011 NEXT_IGNORE_INCORRECT_LOCKFILE=1 node scripts/start-e2e-server.mjs",
    url: "http://127.0.0.1:3011",
    reuseExistingServer: false,
  },
});
