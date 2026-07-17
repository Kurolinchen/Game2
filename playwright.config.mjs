import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  expect: { timeout: 12_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:5173",
    headless: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
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
