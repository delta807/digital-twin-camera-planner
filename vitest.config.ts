/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { defineConfig } from 'vitest/config';

// Vitest config for fast, pure-logic UNIT tests (the Playwright suite in tests/ is the e2e/smoke
// layer and is excluded here). All targets are pure math or localStorage-backed, so we run in the
// plain Node environment and supply an in-memory localStorage via setup.ts — no WebGL/WASM/jsdom,
// which keeps CI quick and deterministic.
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
    exclude: ['tests/**', 'node_modules/**', 'dist/**'],
    clearMocks: true,
    restoreMocks: true,
  },
});
