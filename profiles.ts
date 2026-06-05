/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ArmInstance, WorkcellConfig } from './types';

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
}

const KEY = 'so101-layout-profiles';

/** All saved profiles, newest first. Tolerates corrupt/missing storage. */
export function listProfiles(): LayoutProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as LayoutProfile[];
    return Array.isArray(arr) ? arr.slice().sort((a, b) => b.savedAt - a.savedAt) : [];
  } catch {
    return [];
  }
}

/** Save (or overwrite by name) a profile. Returns the updated list. */
export function saveProfile(profile: LayoutProfile): LayoutProfile[] {
  const others = listProfiles().filter((p) => p.name !== profile.name);
  const next = [profile, ...others];
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* quota / disabled — ignore */ }
  return next;
}

/** Delete a profile by name. Returns the updated list. */
export function deleteProfile(name: string): LayoutProfile[] {
  const next = listProfiles().filter((p) => p.name !== name);
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}
