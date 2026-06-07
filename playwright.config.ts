/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke-test config: boots the Vite dev server, runs the tests in tests/ against Chromium.
 * Kept deliberately small — the goal is a fast regression guard (app loads, no console errors,
 * key controls present), not full e2e coverage.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 120_000,
  expect: { timeout: 90_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3000', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
