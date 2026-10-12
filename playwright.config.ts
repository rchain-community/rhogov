import { defineConfig } from "@playwright/test";

// End-to-end tests open the BUILT single-file app from disk (file://) — the
// serverless deployment itself — against a live rnode with funded dev keys.
//   npm run build && RHOGOV_NODE=http://127.0.0.1:40403 npm run test:e2e
export default defineConfig({
  testDir: "tests/e2e",
  // The cold-start UX audit (tests/e2e/audit/) is expected to be RED: every probe
  // asserts behaviour that does not exist yet, so a red there is a finding, not a
  // broken test. It is kept out of the normal suite and run with `npm run test:audit`.
  testIgnore: process.env.RHOGOV_AUDIT ? [] : ["**/audit/**"],
  timeout: 15 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  reporter: [["list"]],
  use: {
    // Sandboxes that reach the internet only through an intercepting proxy
    // (set RHOGOV_PROXY=1): route the browser through HTTPS_PROXY and accept its CA.
    ...(process.env.RHOGOV_PROXY && process.env.HTTPS_PROXY
      ? { proxy: { server: process.env.HTTPS_PROXY }, ignoreHTTPSErrors: true }
      : {}),
    viewport: { width: 1200, height: 900 },
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
    trace: "retain-on-failure",
    // A stuck screen should fail in a minute with a snapshot, not wait out the whole test.
    actionTimeout: 60_000,
  },
});
