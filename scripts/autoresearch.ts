/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch CLI runner. Drives the live twin headlessly (Playwright) to score candidate layouts,
 * then writes a Pareto front + top-10 report. Run via vite-node (handles TS/ESM):
 *
 *   npm run autoresearch -- --n-sides 3,4,5,6 --arms 1,2 --size 0.4 --trials 200 --out tasks/autoresearch_runs/run-001
 *
 * NOTE (slice 1→2): this scores via window.__autoresearch.scoreCurrentScene(). Varying the config per
 * trial needs window.__autoresearch.applyConfig(cfg) (slice 2). Until that exists the runner scores the
 * CURRENT scene once as an end-to-end plumbing smoke test and warns — it does NOT fake a sweep.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { buildCampaign } from '../autoresearch/candidates';
import { paretoFront, knee, type Trial } from '../autoresearch/pareto';
import { resultsJson, paretoCsv, topMarkdown } from '../autoresearch/report';
import type { Cfg, Result } from '../autoresearch/types';

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}
const nums = (s?: string) => (s ? s.split(',').map(Number) : []);

async function main() {
  const baseUrl = arg('base-url', 'http://localhost:3000')!;
  const out = arg('out', 'tasks/autoresearch_runs/run')!;
  const trials = Number(arg('trials', '200'));
  const spec = {
    nSides: nums(arg('n-sides', '3,4,5,6,8')),
    arms: nums(arg('arms', '1,2')) as Array<1 | 2>,
    size: Number(arg('size', '0.4')),
  };
  const candidates = buildCampaign(spec).slice(0, trials);
  console.log(`[autoresearch] ${candidates.length} candidate configs · ${baseUrl} · out=${out}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  // wait for the hook + a non-null first score (app load + MuJoCo + first reachability compute)
  await page.waitForFunction(() => {
    const ar = (window as unknown as { __autoresearch?: { scoreCurrentScene: () => unknown } }).__autoresearch;
    return !!ar && ar.scoreCurrentScene() != null;
  }, { timeout: 120_000 });

  const hasApply = await page.evaluate(() =>
    typeof (window as unknown as { __autoresearch?: { applyConfig?: unknown } }).__autoresearch?.applyConfig === 'function');
  if (!hasApply) {
    console.warn('[autoresearch] window.__autoresearch.applyConfig MISSING (slice 2). Scoring the CURRENT scene once as a smoke test — NOT a real sweep.');
  }

  const out_trials: Trial[] = [];
  const loop = hasApply ? candidates : candidates.slice(0, 1);
  for (let i = 0; i < loop.length; i++) {
    const cfg = loop[i];
    const result = await page.evaluate(async (c: Cfg) => {
      const ar = (window as unknown as { __autoresearch: { applyConfig?: (c: Cfg) => Promise<void>; scoreCurrentScene: () => Result | null } }).__autoresearch;
      if (ar.applyConfig) await ar.applyConfig(c);
      return ar.scoreCurrentScene();
    }, cfg);
    if (result) out_trials.push({ cfg, result });
    if ((i + 1) % 25 === 0) console.log(`[autoresearch] ${i + 1}/${loop.length}`);
  }
  await browser.close();

  const front = paretoFront(out_trials);
  const best = knee(front);
  mkdirSync(out, { recursive: true });
  writeFileSync(`${out}/results.json`, resultsJson(out_trials));
  writeFileSync(`${out}/pareto.csv`, paretoCsv(front));
  writeFileSync(`${out}/top10.md`, topMarkdown(out_trials, best, 10));
  console.log(`[autoresearch] ${out_trials.length} scored · ${front.length} on Pareto front · wrote results.json, pareto.csv, top10.md to ${out}`);
  if (best) console.log(`[autoresearch] recommended (knee): ${best.cfg.shapeSides}-gon, ${best.cfg.arms} arm(s)`);
}

main().catch((e) => { console.error('[autoresearch] failed:', e); process.exit(1); });
