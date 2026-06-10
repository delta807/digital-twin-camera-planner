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

/** The layout that ships as the startup default when the user hasn't chosen their own (must exist in
 *  BUILTIN_PROFILES so a fresh browser actually has it). Change this one constant to re-home the default. */
export const SHIPPED_DEFAULT_PROFILE = 'bestagon';
const DEFAULT_KEY = 'so101-default-profile';

/** The user's per-device default profile name ('' = fall back to the shipped default). */
export function getDefaultProfileName(): string {
  try { return localStorage.getItem(DEFAULT_KEY) || ''; } catch { return ''; }
}

/** Pin (or clear, with null/'') the per-device default profile that auto-loads on startup. */
export function setDefaultProfileName(name: string | null): void {
  try { if (name) localStorage.setItem(DEFAULT_KEY, name); else localStorage.removeItem(DEFAULT_KEY); } catch { /* ignore */ }
}

/** Which profile auto-loads on a fresh session: the user's per-device pick if it still exists, else the
 *  shipped default (bestagon), else the legacy IRL-layout, else the newest. Null only if none exist. */
export function resolveDefaultProfile(profiles: LayoutProfile[]): LayoutProfile | null {
  if (!profiles.length) return null;
  const byName = (n: string) => (n ? profiles.find((p) => p.name === n) : undefined);
  return byName(getDefaultProfileName()) || byName(SHIPPED_DEFAULT_PROFILE) || byName('IRL-layout') || profiles[0];
}
