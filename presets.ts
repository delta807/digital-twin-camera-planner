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
  // e.g. { name: 'Lab bench A', savedAt: 1, builtin: true, workcell: {...}, arms: [...], camera: {...} },
];
