/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LayoutProfile } from './profiles';

/**
 * BUILTIN_PROFILES — workspace layouts shipped *with the app* (committed to git), so anyone who
 * clones the repo or opens the hosted (e.g. Netlify) site gets your team's arrangements without
 * rebuilding them. These are read-only in the UI (load only, no delete); a same-named user profile
 * in localStorage overrides the built-in.
 *
 * To add one: build the layout in the app → open **Layout profiles** → save it → click
 * **Export JSON** (copies all your saved profiles to the clipboard) → paste the entry/entries
 * below and commit. `savedAt` can be any number (it's only used for sort order).
 */
export const BUILTIN_PROFILES: LayoutProfile[] = [
  // The team's default IRL arrangement — auto-loaded on startup (App.tsx) so the hosted/Netlify site
  // opens into it without anyone re-building it. Captured from the rig and committed here.
  {
    name: 'IRL-layout',
    savedAt: 1780817579256,
    builtin: true,
    workcell: {
      length: 0.83, width: 0.83, barHeight: 0.024, barWidth: 0.024, postHeight: 0.84, shapeSides: 4,
      postX: 0.41754723596786, postY: -0.29919053155075065, extraPosts: [], stations: [], extraCameras: [],
    },
    arms: [{ id: 'so101-1', label: 'SO101 1', x: 0, y: -0.41507511169779293, yaw: 3.141592653589793, primary: true }],
    camera: {
      position: [0.3978224732891565, -0.30419994319984617, 0.9796930009124906],
      quaternion: [0.10884705242423103, 0.1617069796509161, 0.6997280546164328, 0.6873018416194134],
      hFovDeg: 69.4,
    },
  },
];
