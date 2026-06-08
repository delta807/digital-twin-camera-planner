/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Smoke test — the cheap regression guard requested in the session: load the app, confirm it
 * boots into the workspace with no console errors, and that the core controls are present. This
 * catches the "a refactor blanked the screen / threw on load" class of regression automatically.
 */
import { test, expect } from '@playwright/test';

// Benign messages we don't want to fail the build on (third-party/runtime noise, not real bugs).
const IGNORE = [
  /module .* has been externalized/i,   // vite browser-compat note (mujoco-js)
  /Download the React DevTools/i,
  /\[vite\]/i,
];

test('app boots into the workspace with no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error' && !IGNORE.some((re) => re.test(m.text()))) errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');

  // The SO-101 twin finishes loading into the dock (sim + model fetch can take a while in CI).
  await expect(page.getByText('Insert', { exact: true })).toBeVisible({ timeout: 90_000 });

  // Core surfaces are present.
  await expect(page.getByText('Bodies', { exact: true })).toBeVisible();
  await expect(page.getByText('Camera Feeds', { exact: true })).toBeVisible();
  await expect(page.getByText('Gemini ER 1.6', { exact: true })).toBeVisible();
  // Insert palette has the add cards (accessible name = the card's visible label).
  await expect(page.getByRole('button', { name: 'SO-101', exact: true })).toBeVisible();

  expect(errors, `console errors:\n${errors.join('\n')}`).toEqual([]);
});
