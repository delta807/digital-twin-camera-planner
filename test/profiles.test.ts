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

describe('profiles (localStorage CRUD)', () => {
  it('returns empty lists on a clean store', () => {
    expect(listUserProfiles()).toEqual([]);
    expect(listProfiles()).toEqual([]);
  });

  it('saves profiles newest-first by savedAt and tags builtin:false', () => {
    saveProfile(profile('A', 1));
    const list = saveProfile(profile('B', 2));
    expect(list.map((p) => p.name)).toEqual(['B', 'A']);
    expect(list.every((p) => p.builtin === false)).toBe(true);
  });

  it('overwrites by name (no duplicates)', () => {
    saveProfile(profile('A', 1));
    const list = saveProfile(profile('A', 9));
    expect(list).toHaveLength(1);
    expect(list[0].savedAt).toBe(9);
  });

  it('deletes a user profile by name', () => {
    saveProfile(profile('A', 1));
    expect(deleteProfile('A')).toEqual([]);
    expect(listUserProfiles()).toEqual([]);
  });

  it('tolerates a corrupt store without throwing', () => {
    localStorage.setItem(KEY, 'not json');
    expect(listUserProfiles()).toEqual([]);
    expect(listProfiles()).toEqual([]);
  });
});
