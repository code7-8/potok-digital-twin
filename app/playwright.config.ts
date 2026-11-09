import { defineConfig } from '@playwright/test';

const externalURL = process.env.POTOK_TEST_URL;
export default defineConfig({
  testDir: './browser-tests',
  outputDir: './work/playwright-results',
  timeout: 180_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: externalURL ?? 'http://127.0.0.1:5173',
    viewport: { width: 1600, height: 1250 },
    reducedMotion: 'reduce',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    launchOptions: {
      ...(process.env.POTOK_CHROMIUM_PATH ? { executablePath: process.env.POTOK_CHROMIUM_PATH } : {}),
      args: ['--enable-unsafe-swiftshader'],
    },
  },
  webServer: externalURL ? undefined : {
    command: 'pnpm local --dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
