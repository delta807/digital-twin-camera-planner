/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch CLI runner. Drives the live twin headlessly (Playwright) to sweep candidate layouts
 * under each OBJECT REGION (centre + corners), then writes a per-region Pareto front + a cross-region
 * summary. Run via vite-node:
 *
 *   # 1. generate the swept variables (or hand-author campaign.json):
 *   npm run gen-campaign -- --n-sides 3,4,5,6 --sizes 0.3,0.4,0.5 --arms 1,2 --out tasks/autoresearch_runs/campaign.json
 *   # 2. run it (parallel across worker tabs):
 *   npm run autoresearch -- --manifest tasks/autoresearch_runs/campaign.json --workers 2 --out tasks/autoresearch_runs/run-001
 *
 * Per candidate: applyConfig ONCE (the expensive step), then score under EVERY region (cheap ~0.4 s).
 * Triage at fast fidelity; the per-region Pareto finalists are re-scored at FULL fidelity before ranking.
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chromium, type Page } from 'playwright';
import { generateCampaign, regionsFor } from '../autoresearch/campaign';
import { paretoFront, knee, type Trial } from '../autoresearch/pareto';
import { paretoCsv } from '../autoresearch/report';
import type { Cfg, Result, Zone, ScoreParams } from '../autoresearch/types';

const arg = (n: string, d?: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : d; };
const nums = (s?: string) => (s ? s.split(',').map(Number) : []);

// NB: anything passed to page.evaluate runs in the BROWSER — it can only use its args + browser globals,
// never Node-scope helpers. So window.__autoresearch is accessed inline (cast) inside each closure.
interface RegionTrial { ci: number; cfg: Cfg; region: Zone; result: Result; }

async function newReadyPage(browser: Awaited<ReturnType<typeof chromium.launch>>, baseUrl: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => { const ar = (window as any).__autoresearch; return !!ar && ar.scoreCurrentScene() != null; }, { timeout: 120_000 });
  return page;
}

/** Apply a candidate at the given fidelity, then score it under each region. */
async function sweepCandidate(page: Page, ci: number, cfg: Cfg, regions: Zone[], fast: boolean): Promise<RegionTrial[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(async ({ c, fast }) => { await (window as any).__autoresearch.applyConfig(c, { fast }); }, { c: cfg, fast });
  const out: RegionTrial[] = [];
  for (const region of regions) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await page.evaluate(({ region, fast }) => (window as any).__autoresearch.scoreCurrentScene(undefined, { fast, zone: region }), { region, fast }) as Result | null;
    if (result) out.push({ ci, cfg, region, result });
  }
  return out;
}

async function main() {
  const baseUrl = arg('base-url', 'http://localhost:3000')!;
  const out = arg('out', 'tasks/autoresearch_runs/run')!;
  const workers = Math.max(1, Number(arg('workers', '2')));
  const blobRadius = Number(arg('blob-radius', '0.07'));

  // candidates: from a generated manifest, or generated inline from args.
  const manifest = arg('manifest');
  let candidates: Cfg[];
  if (manifest) { candidates = JSON.parse(readFileSync(manifest, 'utf8')).candidates as Cfg[]; }
  else candidates = generateCampaign({ nSides: nums(arg('n-sides', '3,4,5,6')), sizes: nums(arg('sizes', '0.4')), arms: nums(arg('arms', '1,2')) as Array<1 | 2> });
  const trials = Number(arg('trials', String(candidates.length)));
  candidates = candidates.slice(0, trials);
  console.log(`[autoresearch] ${candidates.length} candidates · ${workers} worker(s) · ${baseUrl} · out=${out}`);

  const browser = await chromium.launch({ headless: true });
  const pages = await Promise.all(Array.from({ length: workers }, () => newReadyPage(browser, baseUrl)));

  // split candidates round-robin across workers; each worker sweeps its chunk (apply + score all regions).
  const all: RegionTrial[] = [];
  let done = 0;
  await Promise.all(pages.map(async (page, w) => {
    for (let i = w; i < candidates.length; i += workers) {
      const cfg = candidates[i];
      const trials = await sweepCandidate(page, i, cfg, regionsFor(cfg, blobRadius), true);
      all.push(...trials);
      if (++done % 10 === 0) console.log(`[autoresearch] triage ${done}/${candidates.length} candidates`);
    }
  }));

  // group by region label → per-region candidate trials; full-fidelity re-score of each region's finalists.
  const byRegion = new Map<string, Trial[]>();
  for (const t of all) { const a = byRegion.get(t.region.label) ?? []; a.push({ cfg: t.cfg, result: t.result }); byRegion.set(t.region.label, a); }

  // GSD/λ OUTER sweep settings — re-score each region's WINNER across the D435i RGB/depth bands + a
  // no-torque variant, to check the recommendation is robust to the objective-parameters (#A2). Cheap:
  // params only change scoring, not the applied scene.
  const PARAM_SETTINGS: Array<{ label: string } & Partial<ScoreParams>> = [
    { label: 'rgb-tight', RGB_GSD_TARGET: 0.3, DEPTH_GSD_TARGET: 0.6 },
    { label: 'mid', RGB_GSD_TARGET: 0.5, DEPTH_GSD_TARGET: 1.1 },
    { label: 'loose', RGB_GSD_TARGET: 0.9, DEPTH_GSD_TARGET: 1.9 },
    { label: 'no-torque', RGB_GSD_TARGET: 0.5, DEPTH_GSD_TARGET: 1.1, lambda: 0 },
  ];
  const sensitivity = new Map<string, Array<{ label: string; feasible: boolean; taskGrasp: number; perception: number }>>();

  console.log('[autoresearch] re-scoring per-region Pareto finalists at full fidelity + GSD/λ sensitivity…');
  const page0 = pages[0];
  for (const [label, trialsForRegion] of byRegion) {
    const front = paretoFront(trialsForRegion);
    for (const t of front) {
      const region = regionsFor(t.cfg, blobRadius).find((z) => z.label === label)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page0.evaluate(async (c) => { await (window as any).__autoresearch.applyConfig(c, { fast: false }); }, t.cfg);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = await page0.evaluate(({ region }) => (window as any).__autoresearch.scoreCurrentScene(undefined, { fast: false, zone: region }), { region }) as Result | null;
      if (r) t.result = r;
    }
    // sensitivity sweep on this region's winner (knee): score it under every GSD/λ setting.
    const best = knee(paretoFront(trialsForRegion));
    if (best) {
      const region = regionsFor(best.cfg, blobRadius).find((z) => z.label === label)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await page0.evaluate(async (c) => { await (window as any).__autoresearch.applyConfig(c, { fast: false }); }, best.cfg);
      const rows: Array<{ label: string; feasible: boolean; taskGrasp: number; perception: number }> = [];
      for (const s of PARAM_SETTINGS) {
        const { label: sl, ...params } = s;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = await page0.evaluate(({ region, params }) => (window as any).__autoresearch.scoreCurrentScene(params, { fast: false, zone: region }), { region, params }) as Result | null;
        if (r) rows.push({ label: sl, feasible: r.feasible, taskGrasp: r.objectives.taskGrasp, perception: r.objectives.perception });
      }
      sensitivity.set(label, rows);
    }
  }
  await browser.close();

  // report: per-region pareto csv + a cross-region summary (does the winner change by region?).
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/results.json`, JSON.stringify(all.map((t) => ({ ci: t.ci, region: t.region.label, cfg: t.cfg, result: t.result })), null, 2));
  const summary: string[] = ['# /autoresearch — per-region winners', ''];
  const cfgLabel = (c: Cfg) => `${c.shapeSides}-gon r${c.size.toFixed(2)} · ${c.arms}arm · cam z${c.camera.z.toFixed(2)} tilt${c.camera.tilt}°`;
  for (const [label, trialsForRegion] of byRegion) {
    const front = paretoFront(trialsForRegion);
    const best = knee(front);
    writeFileSync(`${out}/region-${label}.csv`, paretoCsv(front));
    // Save the winning layout as a twin-loadable Cfg: re-apply with
    //   window.__autoresearch.applyConfig(require('./winner-<region>.json')) in the twin console.
    if (best) writeFileSync(`${out}/winner-${label}.json`, JSON.stringify(best.cfg, null, 2));
    summary.push(`## objects @ ${label}`, best ? `- **best:** ${cfgLabel(best.cfg)} — taskGrasp ${best.result.objectives.taskGrasp.toFixed(3)}, perception ${best.result.objectives.perception.toFixed(3)}${best.result.objectives.collaboration != null ? `, collab ${best.result.objectives.collaboration.toFixed(3)}` : ''} → winner-${label}.json` : '- _no feasible config_', `- ${front.length} on Pareto front of ${trialsForRegion.length} feasible-or-not`);
    const sens = sensitivity.get(label);
    if (sens && sens.length) {
      const feasN = sens.filter((s) => s.feasible).length;
      summary.push(`- GSD/λ sensitivity (winner stays feasible in ${feasN}/${sens.length} settings): ` +
        sens.map((s) => `${s.label} ${s.feasible ? `tg${s.taskGrasp.toFixed(2)}/pc${s.perception.toFixed(2)}` : '✗'}`).join('  ·  '));
    }
    summary.push('');
  }
  writeFileSync(`${out}/summary.md`, summary.join('\n'));
  console.log(`[autoresearch] ${all.length} region-trials · ${byRegion.size} regions · wrote results.json, region-*.csv, summary.md to ${out}`);
}

main().catch((e) => { console.error('[autoresearch] failed:', e); process.exit(1); });
