import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/ui",
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
});
