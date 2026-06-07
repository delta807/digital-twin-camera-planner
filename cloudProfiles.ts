/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Thin client for the team layout-sync function (netlify/functions/layouts). Same-origin fetch,
 * so it needs no extra deps and no CORS. Everything fails soft: under plain `vite dev` (no
 * function) these are a no-op / empty, and the app keeps working off localStorage + bundled
 * presets. Real sync activates automatically once deployed to Netlify (or under `netlify dev`).
 */
import type { LayoutProfile } from './profiles';

const ENDPOINT = '/.netlify/functions/layouts';

/** Shared profiles published by the team (empty when the function isn't reachable). */
export async function fetchSharedProfiles(): Promise<LayoutProfile[]> {
  try {
    const r = await fetch(ENDPOINT, { method: 'GET' });
    if (!r.ok) return [];
    const data = (await r.json()) as { profiles?: LayoutProfile[] };
    return Array.isArray(data.profiles) ? data.profiles.map((p) => ({ ...p, shared: true })) : [];
  } catch {
    return []; // no function (local vite) — fall back silently
  }
}

/** Publish the given profiles to the shared store. Returns false when sync isn't available. */
export async function publishSharedProfiles(profiles: LayoutProfile[]): Promise<boolean> {
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ profiles }),
    });
    return r.ok;
  } catch {
    return false;
  }
}
