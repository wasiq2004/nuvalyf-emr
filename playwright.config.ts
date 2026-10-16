import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against a running NuvaLyf server (npm run build && npm start,
// or docker compose). They create their own clinic through the operations console,
// so the only prerequisite is a Super Admin account:
//   E2E_BASE_URL            default http://localhost:3000
//   E2E_ADMIN_EMAIL         default PLATFORM_ADMIN_EMAIL
//   E2E_ADMIN_PASSWORD      default PLATFORM_ADMIN_PASSWORD
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
