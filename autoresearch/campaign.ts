/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — campaign generation. Produces the full sweep as data (a manifest the CLI loads):
 *   • CANDIDATES (the physical knobs the optimizer searches): shapeSides × table SIZES (area sweep) ×
 *     arms × edge placements × camera poses — emitted INTERLEAVED so a truncated run still spans
 *     shapes + arm counts.
 *   • REGIONS (the OUTER sweep): per candidate, the object-zone blobs = centre + each corner.
 * Pure + deterministic.
 */
import type { Cfg, Zone } from './types';

export interface CampaignSpec {
  nSides: number[];          // [3,4,5,6,8]
  sizes: number[];           // table circumradii to sweep (the area axis), e.g. [0.30, 0.40, 0.50]
  arms: Array<1 | 2>;        // [1,2]
  origin?: [number, number]; // worktop centre (default [0,0])
  cameraHeights?: number[];  // [0.55, 0.7, 0.85]
  cameraTilts?: number[];    // deg, [0, 20]
  blobRadius?: number;       // object-blob radius (m), default 0.07
}

/** Edge-midpoint mount of a regular N-gon (circumradius r, centre o), yaw facing the centre. */
function edgeMount(o: [number, number], r: number, n: number, edge: number) {
  const apothem = r * Math.cos(Math.PI / n);
  const ang = (2 * Math.PI * (edge + 0.5)) / n;
  const x = o[0] + apothem * Math.cos(ang), y = o[1] + apothem * Math.sin(ang);
  return { x, y, yaw: Math.atan2(o[1] - y, o[0] - x) };
}

/** The object-zone regions for a candidate: centre + one blob near each corner (inset to 0.6·size). */
export function regionsFor(cfg: Cfg, blobRadius = 0.07, origin: [number, number] = [0, 0]): Zone[] {
  const zones: Zone[] = [{ center: [origin[0], origin[1]], radius: blobRadius, label: 'center' }];
  const r = 0.6 * cfg.size;
  for (let k = 0; k < cfg.shapeSides; k++) {
    const ang = (2 * Math.PI * k) / cfg.shapeSides;       // vertex direction
    zones.push({ center: [origin[0] + r * Math.cos(ang), origin[1] + r * Math.sin(ang)], radius: blobRadius, label: `corner-${k + 1}` });
  }
  return zones;
}

/** Enumerate candidates, INTERLEAVED across (shape × arms) so the first N span shapes + arm counts. */
export function generateCampaign(spec: CampaignSpec): Cfg[] {
  const o = spec.origin ?? [0, 0];
  const heights = spec.cameraHeights ?? [0.55, 0.7, 0.85];
  const tilts = spec.cameraTilts ?? [0, 20];
  const groups = new Map<string, Cfg[]>();             // key `${n}|${arms}` → its candidates
  const push = (n: number, arms: 1 | 2, c: Cfg) => { const k = `${n}|${arms}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(c); };

  for (const n of spec.nSides) for (const size of spec.sizes) for (const arms of spec.arms) {
    const placements: Array<Array<{ x: number; y: number; yaw: number }>> = [];
    if (arms === 1) for (let e = 0; e < n; e++) placements.push([edgeMount(o, size, n, e)]);
    else { const opp = Math.floor(n / 2); for (let e = 0; e < n; e++) placements.push([edgeMount(o, size, n, e), edgeMount(o, size, n, (e + opp) % n)]); }
    for (const armBases of placements) for (const z of heights) for (const tilt of tilts)
      push(n, arms, { shapeSides: n, size, arms, armBases, camera: { x: o[0], y: o[1], z, tilt }, taskDistribution: { kind: 'grid' } });
  }

  // round-robin merge the groups → consecutive candidates alternate shape/arms.
  const lists = [...groups.values()];
  const out: Cfg[] = [];
  for (let i = 0; out.length < lists.reduce((a, l) => a + l.length, 0); i++)
    for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}
