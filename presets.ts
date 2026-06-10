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
  // 'bestagon' — the SHIPPED startup default (profiles.SHIPPED_DEFAULT_PROFILE), auto-loaded on a fresh
  // session unless the user picked their own per-device default. A 4-cell hexagon ("bestagon") lab: base
  // worktop + 3 satellite stations, 9 SO-101 arms. Exported from the live app and committed here.
  {
    name: 'bestagon',
    savedAt: 1780924292794,
    builtin: true,
    workcell: {
      length: 0.83, width: 0.83, barHeight: 0.024, barWidth: 0.024, postHeight: 0.84, shapeSides: 6,
      postX: 0.41754723596786, postY: -0.29919053155075065, extraPosts: [], extraCameras: [],
      originX: 0, originY: -0.3683687365999175, yaw: 0,
      stations: [
        { id: 'station-2', x: 1.03, y: 0, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-3', x: 2.06, y: 0, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-4', x: 2.0301837900509465, y: -1.766053778895441, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-5', x: 3.0900000000000003, y: 0, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
      ],
      props: [
        { id: 'prop-1', x: 0.93, y: 0.06, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-2' },
        { id: 'prop-2', x: 1.05, y: 0.1, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-2' },
        { id: 'prop-3', x: 1.1300000000000001, y: -0.02, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-2' },
        { id: 'prop-4', x: 1.96, y: 0.06, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-3' },
        { id: 'prop-5', x: 2.08, y: 0.1, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-3' },
        { id: 'prop-6', x: 2.16, y: -0.02, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-3' },
        { id: 'prop-7', x: 1.9301837900509464, y: -1.7060537788954409, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-4' },
        { id: 'prop-8', x: 2.0501837900509465, y: -1.6660537788954408, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-4' },
        { id: 'prop-9', x: 2.1301837900509466, y: -1.786053778895441, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-4' },
        { id: 'prop-10', x: 2.99, y: 0.06, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-5' },
        { id: 'prop-11', x: 3.1100000000000003, y: 0.1, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-5' },
        { id: 'prop-12', x: 3.1900000000000004, y: -0.02, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-5' },
      ],
    },
    arms: [
      { id: 'so101-1', label: 'SO101 1', x: -0.359400542570542, y: -0.3683687365999174, yaw: 1.5707963267948963, primary: true },
      { id: 'so101-2', label: 'SO101 2', x: 0.179700271285271, y: -0.31124999999999997, yaw: 3.6651914291880923 },
      { id: 'so101-3', label: 'SO101 3', x: 1.03, y: -0.415, yaw: 3.141592653589793, stationId: 'station-2' },
      { id: 'so101-4', label: 'SO101 4', x: 0.670599457429458, y: 0.20750000000000013, yaw: 1.0471975511965974 },
      { id: 'so101-5', label: 'SO101 5', x: 2.06, y: -0.415, yaw: 3.141592653589793, stationId: 'station-3' },
      { id: 'so101-6', label: 'SO101 6', x: 2.06, y: 0.415, yaw: 0 },
      { id: 'so101-7', label: 'SO101 7', x: 2.2098840613362176, y: -2.077303778895441, yaw: 3.6651914291880923, stationId: 'station-4' },
      { id: 'so101-8', label: 'SO101 8', x: 1.8504835187656754, y: -1.4548037788954409, yaw: 0.5235987755982989 },
      { id: 'so101-9', label: 'SO101 9', x: 3.0900000000000003, y: -0.415, yaw: 3.141592653589793, stationId: 'station-5' },
    ],
    camera: {
      position: [-0.056692173508041774, 0.01151296483907513, 0.8044180573316573],
      quaternion: [0, 0, -0.259964795334367, 0.9656180948940223],
      hFovDeg: 69.4,
    },
  },
  // 'bestagons 2' — a wider 6-cell variant (10 arms, a 4-sided satellite among the hexagons, lower camera).
  {
    name: 'bestagons 2',
    savedAt: 1780925155802,
    builtin: true,
    workcell: {
      length: 0.83, width: 0.83, barHeight: 0.024, barWidth: 0.024, postHeight: 0.84, shapeSides: 6,
      postX: 0.41754723596786, postY: -0.29919053155075065, extraPosts: [], extraCameras: [],
      originX: 0, originY: -0.3683687365999175, yaw: 0,
      stations: [
        { id: 'station-2', x: 1.03, y: 0, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-3', x: 2.06, y: 0, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-4', x: 2.0301837900509465, y: -1.766053778895441, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-5', x: 0.15751891944074536, y: -1.3041182710548418, yaw: 0, shapeSides: 4, length: 0.75, width: 0.75, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
        { id: 'station-7', x: 4.12, y: 0, yaw: 0, shapeSides: 6, length: 0.83, width: 0.83, postX: 0.41754723596786, postY: -0.29919053155075065, postHeight: 0.84 },
      ],
      props: [
        { id: 'prop-1', x: 0.93, y: 0.06, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-2' },
        { id: 'prop-2', x: 1.05, y: 0.1, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-2' },
        { id: 'prop-3', x: 1.1300000000000001, y: -0.02, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-2' },
        { id: 'prop-4', x: 1.96, y: 0.06, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-3' },
        { id: 'prop-5', x: 2.08, y: 0.1, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-3' },
        { id: 'prop-6', x: 2.16, y: -0.02, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-3' },
        { id: 'prop-7', x: 1.9301837900509464, y: -1.7060537788954409, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-4' },
        { id: 'prop-8', x: 2.0501837900509465, y: -1.6660537788954408, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-4' },
        { id: 'prop-9', x: 2.1301837900509466, y: -1.786053778895441, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-4' },
        { id: 'prop-10', x: 0.057518919440745275, y: -1.2441182710548417, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-5' },
        { id: 'prop-11', x: 0.17751891944074538, y: -1.204118271054842, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-5' },
        { id: 'prop-12', x: 0.25751891944074545, y: -1.3241182710548418, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-5' },
        { id: 'prop-16', x: 4.0200000000000005, y: 0.06, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-7' },
        { id: 'prop-17', x: 4.14, y: 0.1, z: 0.025, yaw: 0, size: 0.05, color: '#3aa6a0', cell: 'station-7' },
        { id: 'prop-18', x: 4.22, y: -0.02, z: 0.025, yaw: 0, size: 0.05, color: '#e0772f', cell: 'station-7' },
      ],
    },
    arms: [
      { id: 'so101-1', label: 'SO101 1', x: -0.359400542570542, y: -0.3683687365999174, yaw: 1.5707963267948963, primary: true },
      { id: 'so101-2', label: 'SO101 2', x: 0.179700271285271, y: -0.6796187365999175, yaw: 3.6651914291880923 },
      { id: 'so101-3', label: 'SO101 3', x: 1.03, y: -0.415, yaw: 3.141592653589793, stationId: 'station-2' },
      { id: 'so101-4', label: 'SO101 4', x: 0.670599457429458, y: 0.20750000000000013, yaw: 1.0471975511965974 },
      { id: 'so101-5', label: 'SO101 5', x: 2.06, y: -0.415, yaw: 3.141592653589793, stationId: 'station-3' },
      { id: 'so101-6', label: 'SO101 6', x: 2.06, y: 0.415, yaw: 0 },
      { id: 'so101-7', label: 'SO101 7', x: 2.2098840613362176, y: -2.077303778895441, yaw: 3.6651914291880923, stationId: 'station-4' },
      { id: 'so101-8', label: 'SO101 8', x: 1.8504835187656754, y: -1.4548037788954409, yaw: 0.5235987755982989 },
      { id: 'so101-9', label: 'SO101 9', x: 0.15751891944074536, y: -1.7191182710548414, yaw: 3.141592653589793, stationId: 'station-5' },
      { id: 'so101-13', label: 'SO101 13', x: 4.12, y: -0.415, yaw: 3.141592653589793, stationId: 'station-7' },
    ],
    camera: {
      position: [-0.056692173508041774, -0.9083287946140904, 0.4632032761890452],
      quaternion: [0.3371209930985384, 0.09076009494560956, -0.2436068553606471, 0.9048578569029591],
      hFovDeg: 69.4,
    },
  },
  // The team's original IRL arrangement (single arm, square table). No longer the startup default
  // (bestagon is) but kept available to load. Captured from the rig and committed here.
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
