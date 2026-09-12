import { defineConfig, devices } from '@playwright/test';

/**
 * E2E runs against the real production build, served by `vite preview`, because the thing that
 * has to work is the thing that ships — not a dev server with different chunking.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // The preview canvas animates, so visual baselines allow a small pixel budget.
      maxDiffPixelRatio: 0.03,
      animations: 'disabled',
    },
  },
  reporter: [['list'], ['html', { open: 'never' }]],
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
