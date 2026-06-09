/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — deterministic candidate generation for a campaign (the "dumb sweep" before any
 * Bayesian search). Pure. Discrete axes (shapeSides × arms) swept exhaustively; arm bases sampled on
 * polygon edge-midpoints (facing centre); camera sampled over a small overhead set.
 */
import type { Cfg } from './types';

export interface CampaignSpec {
  nSides: number[];                 // e.g. [3,4,5,6,8]
  arms: Array<1 | 2>;               // e.g. [1,2]
  size: number;                     // worktop circumradius (m) — fixed per campaign (sweep separately if desired)
  origin?: [number, number];        // worktop centre (default [0,0])
  cameraHeights?: number[];         // e.g. [0.55, 0.7, 0.85]
  cameraTilts?: number[];           // deg, e.g. [0, 20]
}

/** Edge-midpoint of a regular N-gon (circumradius r, centred at o), and the yaw that faces the centre. */
function edgeMount(o: [number, number], r: number, n: number, edge: number): { x: number; y: number; yaw: number } {
  const apothem = r * Math.cos(Math.PI / n);
  const ang = (2 * Math.PI * (edge + 0.5)) / n;       // midpoint of edge `edge`
  const x = o[0] + apothem * Math.cos(ang), y = o[1] + apothem * Math.sin(ang);
  const yaw = Math.atan2(o[1] - y, o[0] - x);          // face the worktop centre
  return { x, y, yaw };
}

/** Enumerate every candidate config for the spec (deterministic order). */
export function buildCampaign(spec: CampaignSpec): Cfg[] {
  const o = spec.origin ?? [0, 0];
  const heights = spec.cameraHeights ?? [0.55, 0.7, 0.85];
  const tilts = spec.cameraTilts ?? [0, 20];
  const out: Cfg[] = [];
  for (const n of spec.nSides) {
    for (const arms of spec.arms) {
      // arm placements: 1 arm → each edge in turn; 2 arms → each (near-)opposite edge pair.
      const placements: Array<Array<{ x: number; y: number; yaw: number }>> = [];
      if (arms === 1) {
        for (let e = 0; e < n; e++) placements.push([edgeMount(o, spec.size, n, e)]);
      } else {
        const opp = Math.floor(n / 2);
        for (let e = 0; e < n; e++) placements.push([edgeMount(o, spec.size, n, e), edgeMount(o, spec.size, n, (e + opp) % n)]);
      }
      for (const armBases of placements) {
        for (const z of heights) for (const tilt of tilts) {
          out.push({
            shapeSides: n, size: spec.size, arms, armBases,
            camera: { x: o[0], y: o[1], z, tilt },
            taskDistribution: { kind: 'grid' },
          });
        }
      }
    }
  }
  return out;
}
