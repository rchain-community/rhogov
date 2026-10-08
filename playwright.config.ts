import { defineConfig } from "@playwright/test";

// End-to-end tests open the BUILT single-file app from disk (file://) — the
// serverless deployment itself — against a live rnode with funded dev keys.
//   npm run build && RHOGOV_NODE=http://127.0.0.1:40403 npm run test:e2e
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    viewport: { width: 1200, height: 900 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
  },
});
