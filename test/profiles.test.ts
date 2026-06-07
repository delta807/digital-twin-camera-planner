/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { listUserProfiles, listProfiles, saveProfile, deleteProfile, type LayoutProfile } from '../profiles';
import { DEFAULT_WORKCELL_CONFIG } from '../types';

const KEY = 'so101-layout-profiles';

const profile = (name: string, savedAt: number): LayoutProfile => ({
  name,
  savedAt,
  workcell: DEFAULT_WORKCELL_CONFIG,
  arms: [],
  camera: null,
});

beforeEach(() => {
  localStorage.clear();
});

// listProfiles() merges user-saved profiles with shipped BUILTIN_PROFILES (presets.ts). These tests
// assert on the USER-saved portion (listUserProfiles, or the non-builtin subset of listProfiles) so
// they stay correct as built-ins are added/removed (e.g. the shipped "IRL-layout").
const userOf = (list: LayoutProfile[]) => list.filter((p) => !p.builtin);

describe('profiles (localStorage CRUD)', () => {
  it('has no user profiles on a clean store', () => {
    expect(listUserProfiles()).toEqual([]);
    expect(userOf(listProfiles())).toEqual([]);
  });

  it('saves user profiles newest-first by savedAt and tags builtin:false', () => {
    saveProfile(profile('A', 1));
    const user = userOf(saveProfile(profile('B', 2)));
    expect(user.map((p) => p.name)).toEqual(['B', 'A']);
    expect(user.every((p) => p.builtin === false)).toBe(true);
  });

  it('overwrites by name (no duplicates)', () => {
    saveProfile(profile('A', 1));
    const a = userOf(saveProfile(profile('A', 9))).filter((p) => p.name === 'A');
    expect(a).toHaveLength(1);
    expect(a[0].savedAt).toBe(9);
  });

  it('deletes a user profile by name', () => {
    saveProfile(profile('A', 1));
    deleteProfile('A');
    expect(listUserProfiles()).toEqual([]);
    expect(userOf(listProfiles())).toEqual([]);
  });

  it('tolerates a corrupt store without throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(listUserProfiles()).toEqual([]);
    expect(() => listProfiles()).not.toThrow();
  });
});
