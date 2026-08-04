import { defineConfig } from '@playwright/test';

const fixturePort = Number(process.env.BYEBAR_E2E_PORT || 43_117);
if (!Number.isInteger(fixturePort) || fixturePort < 1 || fixturePort > 65_535) {
  throw new Error('BYEBAR_E2E_PORT must be an integer between 1 and 65535');
}

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.mjs',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  failOnFlakyTests: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 5000 },
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'list',
  outputDir: 'test-results/e2e',
  use: {
    baseURL: `http://127.0.0.1:${fixturePort}`,
    viewport: { width: 1280, height: 720 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure'
  },
  webServer: {
    command: 'node e2e/fixture-server.mjs',
    url: `http://127.0.0.1:${fixturePort}/healthz`,
    env: { BYEBAR_E2E_PORT: String(fixturePort) },
    reuseExistingServer: false,
    timeout: 15_000
  }
});
