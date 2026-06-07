/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Team layout sync via Netlify Blobs — a tiny site-wide key/value store that persists across
 * deploys. GET returns the shared layout profiles; POST replaces them. Everyone hitting the
 * deployed site (or `netlify dev`) reads/writes the same store, so a teammate can publish a
 * layout once and the rest of the team loads it — no rebuild, no external DB.
 *
 * NOTE: requires `@netlify/blobs` (add it: `npm i @netlify/blobs`) and only runs on Netlify
 * (deploy or `netlify dev`) — under plain `vite dev` the client falls back to localStorage.
 */
import { getStore } from '@netlify/blobs';

const KEY = 'shared-layout-profiles';

export default async (req: Request): Promise<Response> => {
  const store = getStore('so101-layouts');
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  if (req.method === 'GET') {
    const profiles = (await store.get(KEY, { type: 'json' })) ?? [];
    return json({ profiles });
  }

  if (req.method === 'POST') {
    let payload: { profiles?: unknown };
    try { payload = await req.json(); } catch { return json({ error: 'invalid JSON' }, 400); }
    if (!Array.isArray(payload.profiles)) return json({ error: 'profiles must be an array' }, 400);
    // Cap to keep the blob small + mark them as shared.
    const profiles = payload.profiles.slice(0, 100).map((p) => ({ ...(p as object), shared: true }));
    await store.setJSON(KEY, profiles);
    return json({ ok: true, count: profiles.length });
  }

  return json({ error: 'method not allowed' }, 405);
};

// No custom `config.path` — the function is served at the default /.netlify/functions/layouts
// (which the client calls). A custom path inside the reserved /.netlify/functions/* namespace is
// rejected ("cannot be invoked").
