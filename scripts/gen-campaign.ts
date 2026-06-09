/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Generate a /autoresearch campaign manifest (the swept variables) as JSON, for the CLI to auto-load:
 *
 *   npm run gen-campaign -- --n-sides 3,4,5,6 --sizes 0.3,0.4,0.5 --arms 1,2 \
 *     --heights 0.55,0.7,0.85 --tilts 0,20 --out tasks/autoresearch_runs/campaign.json
 *
 * Output: { spec, candidates } — `candidates` are the physical configs (interleaved across shape+arms);
 * the runner derives each candidate's REGIONS (centre + corners) at score time via regionsFor().
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateCampaign, type CampaignSpec } from '../autoresearch/campaign';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const nums = (s?: string) => (s ? s.split(',').map(Number) : []);

const spec: CampaignSpec = {
  nSides: nums(arg('n-sides', '3,4,5,6')),
  sizes: nums(arg('sizes', '0.3,0.4,0.5')),
  arms: nums(arg('arms', '1,2')) as Array<1 | 2>,
  cameraHeights: nums(arg('heights', '0.55,0.7,0.85')),
  cameraTilts: nums(arg('tilts', '0,20')),
  blobRadius: Number(arg('blob-radius', '0.07')),
  edgeFracs: nums(arg('edge-fracs', '0.2,0.5,0.8')),  // mount positions along each edge (corner reach)
};
const out = arg('out', 'tasks/autoresearch_runs/campaign.json')!;
const candidates = generateCampaign(spec);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ spec, candidates }, null, 2));
const regionsPerCandidate = spec.nSides.length ? '(center + N corners per candidate)' : '';
console.log(`[gen-campaign] ${candidates.length} candidates ${regionsPerCandidate} → ${out}`);
console.log(`[gen-campaign] axes: nSides=${spec.nSides} sizes=${spec.sizes} arms=${spec.arms} heights=${spec.cameraHeights} tilts=${spec.cameraTilts}`);
