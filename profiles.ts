/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArmInstance, WorkcellConfig } from './types';
import { BUILTIN_PROFILES } from './presets';

/**
 * A saved positional configuration of the workspace — the spatial layout the user has mapped to
 * the real rig: worktop/post, every arm's base pose, and the overhead D435i pose. Persisted in
 * localStorage so layouts survive reloads and can be switched between (e.g. "bench A", "bench B").
 */
export interface LayoutProfile {
  name: string;
  savedAt: number;
  workcell: WorkcellConfig;
  arms: ArmInstance[];
  camera: {
    position: [number, number, number];
    quaternion: [number, number, number, number]; // full aim + roll
    hFovDeg: number;
  } | null;
  /** Shipped with the repo (read-only in the UI) rather than saved by this user. */
  builtin?: boolean;
  /** Came from the team's shared store (Netlify Blobs) rather than this device. */
  shared?: boolean;
}

const KEY = 'so101-layout-profiles';

/** Raw user-saved profiles from localStorage (excludes the bundled built-ins). */
export function listUserProfiles(): LayoutProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as LayoutProfile[];
    return Array.isArray(arr) ? arr.slice() : [];
  } catch {
    return [];
  }
}

/**
 * All profiles for display, newest first: the user's saved layouts plus any bundled built-ins that
 * a same-named user profile hasn't overridden. Built-ins are tagged so the UI can mark them
 * read-only. Save/delete operate on `listUserProfiles` only, so built-ins are never mutated.
 */
export function listProfiles(): LayoutProfile[] {
  const user = listUserProfiles();
  const userNames = new Set(user.map((p) => p.name));
  const builtins = BUILTIN_PROFILES.filter((p) => !userNames.has(p.name)).map((p) => ({ ...p, builtin: true }));
  return [...user, ...builtins].sort((a, b) => b.savedAt - a.savedAt);
}

/** Save (or overwrite by name) a user profile. Returns the merged display list. */
export function saveProfile(profile: LayoutProfile): LayoutProfile[] {
  const others = listUserProfiles().filter((p) => p.name !== profile.name);
  const next = [{ ...profile, builtin: false }, ...others];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota / disabled — ignore */ }
  return listProfiles();
}

/** Delete a user profile by name (built-ins are immutable). Returns the merged display list. */
export function deleteProfile(name: string): LayoutProfile[] {
  const next = listUserProfiles().filter((p) => p.name !== name);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return listProfiles();
}
