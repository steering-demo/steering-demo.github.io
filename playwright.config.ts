import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 4331);

/**
 * The browser tests build with a Space URL that resolves nowhere and intercept it, so one build
 * covers both the recorded path (`?live=0`) and the live path (route stubbed per test).
 */
export const SPACE_STUB = 'https://steering-space.test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
  webServer: {
    command: `PUBLIC_STEERING_SPACE=${SPACE_STUB} npm run build && node scripts/serve-dist.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/steering/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
