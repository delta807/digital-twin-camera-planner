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
  edgeFracs?: number[];      // mount positions ALONG each edge (0=vertex e, 1=vertex e+1); default [0.2,0.5,0.8]
}

/** Mount on edge `edge` of a regular N-gon at fraction `t` between its two vertices (both at circumradius
 *  r), yaw facing the centre. t=0.5 is the edge midpoint; t≈0.2/0.8 sit near a vertex (to reach a corner). */
function edgeMount(o: [number, number], r: number, n: number, edge: number, t = 0.5) {
  const a0 = (2 * Math.PI * edge) / n, a1 = (2 * Math.PI * (edge + 1)) / n;
  const x = o[0] + r * ((1 - t) * Math.cos(a0) + t * Math.cos(a1));
  const y = o[1] + r * ((1 - t) * Math.sin(a0) + t * Math.sin(a1));
  return { x, y, yaw: Math.atan2(o[1] - y, o[0] - x) };
}

/** The object-zone regions for a candidate: centre + one blob toward each corner. `cornerInset` is the
 *  blob's distance from centre as a fraction of circumradius. 0.45 (default) puts the corner zone in the
 *  arm's serviceable MID-field; pushing it out toward the rim (→0.6+) sits in the near-field where a
 *  top-down SO-101 grasp degrades sharply (the only arm close enough is too close to reach down). */
export function regionsFor(cfg: Cfg, blobRadius = 0.07, origin: [number, number] = [0, 0], cornerInset = 0.45): Zone[] {
  const zones: Zone[] = [{ center: [origin[0], origin[1]], radius: blobRadius, label: 'center' }];
  const r = cornerInset * cfg.size;
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

  const fracs = spec.edgeFracs ?? [0.2, 0.5, 0.8]; // near-vertex + midpoint → corners get servable mounts
  for (const n of spec.nSides) for (const size of spec.sizes) for (const arms of spec.arms) {
    const placements: Array<Array<{ x: number; y: number; yaw: number }>> = [];
    if (arms === 1) for (let e = 0; e < n; e++) for (const t of fracs) placements.push([edgeMount(o, size, n, e, t)]);
    else { const opp = Math.floor(n / 2); for (let e = 0; e < n; e++) for (const t of fracs) placements.push([edgeMount(o, size, n, e, t), edgeMount(o, size, n, (e + opp) % n, t)]); }
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
