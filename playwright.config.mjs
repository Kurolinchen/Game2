import { defineConfig, devices } from "@playwright/test";

// Lets environments with a pre-installed Chromium run the suite without
// downloading browsers, e.g. PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium.
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
  },
  projects: [
    { name: "desktop", testIgnore: /mobile\.spec/ },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
      testMatch: /mobile\.spec/,
    },
  ],
  webServer: [
    {
      command: "npm run start -w @tactics-lite/server",
      url: "http://127.0.0.1:2567/health",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { PORT: "2567" },
    },
    {
      command: "npm run dev -w @tactics-lite/client -- --host 127.0.0.1",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
