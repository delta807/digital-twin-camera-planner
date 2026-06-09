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
interface RegionTrial { ci: number; cfg: Cfg; region: Zone; result: Result; fidelity: 'fast' | 'full'; }

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const stdev = (xs: number[]) => (xs.length ? Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2))) : NaN);
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(3) : '—');
const OBJ_KEYS = ['taskGrasp', 'perception', 'collaboration'] as const;

const evalScore = (page: Page, region: Zone) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(({ region }) => (window as any).__autoresearch.scoreCurrentScene(undefined, { fast: false, zone: region }), { region }) as Promise<Result | null>;
const evalApply = (page: Page, cfg: Cfg) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  page.evaluate(async (c) => { await (window as any).__autoresearch.applyConfig(c, { fast: false }); }, cfg);

interface CalibStat { key: string; mean: number; sd: number; min: number; max: number; n: number; }
interface CalibResult {
  refLabel: string; K: number; pages: number;
  determinism: CalibStat[];  // one apply, K scores — pure scorer noise (expect ~0)
  pipeline: CalibStat[];     // K applies each scored — the apply→settle band that gates winner ties
  interPageSd: Record<string, number>;
  wobble: { armsSeen: number[]; collabNull: number; collabNum: number; bothReachSeen: number[] };
}
const statsFor = (samples: Array<Record<string, number>>, key: string): CalibStat => {
  const xs = samples.map((s) => s[key]).filter(Number.isFinite);
  return { key, mean: xs.length ? mean(xs) : NaN, sd: xs.length ? stdev(xs) : NaN,
    min: xs.length ? Math.min(...xs) : NaN, max: xs.length ? Math.max(...xs) : NaN, n: xs.length };
};

/** #A6(a) noise calibration. Two DISTINCT noise classes (DIRECTION 2b):
 *   · determinism — one apply, K scores: pure scorer repeatability (≈0; settled scene is deterministic).
 *   · pipeline   — K applies each scored: applyConfig→settle variance (the class the camera race + arm
 *                  instantiation wobble live in). THIS is the band that gates winner ties, not determinism.
 *  Also tracks instantiation wobble across the K applies (raw.arms, collaboration null↔num, bothReachFrac
 *  — DIRECTION 5: identical 2-arm cfg scored collab=null in one run, 0.000 in another). Use a 2-ARM ref. */
async function calibrate(pages: Page[], cfg: Cfg, region: Zone, K: number): Promise<CalibResult> {
  const det: Array<Record<string, number>> = [];
  const pipe: Array<Record<string, number>> = [];
  const pipePerPageMeans: Record<string, number[]> = { taskGrasp: [], perception: [], collaboration: [] };
  const wobble = { armsSeen: new Set<number>(), collabNull: 0, collabNum: 0, bothReachSeen: new Set<number>() };
  const row = (r: Result) => ({ taskGrasp: r.objectives.taskGrasp, perception: r.objectives.perception, collaboration: r.objectives.collaboration ?? NaN });
  for (const page of pages) {
    // determinism: settle once, then K scores.
    await evalApply(page, cfg);
    for (let k = 0; k < K; k++) { const r = await evalScore(page, region); if (r) det.push(row(r)); }
    // pipeline: re-apply (re-settle) before each score.
    const pageRows: Array<Record<string, number>> = [];
    for (let k = 0; k < K; k++) {
      await evalApply(page, cfg);
      const r = await evalScore(page, region);
      if (!r) continue;
      pageRows.push(row(r)); pipe.push(row(r));
      wobble.armsSeen.add(r.raw.arms);
      wobble.bothReachSeen.add(Number((r.raw.bothReachFrac ?? 0).toFixed(3)));
      if (r.objectives.collaboration == null) wobble.collabNull++; else wobble.collabNum++;
    }
    for (const key of OBJ_KEYS) { const xs = pageRows.map((s) => s[key]).filter(Number.isFinite); if (xs.length) pipePerPageMeans[key].push(mean(xs)); }
  }
  const interPageSd: Record<string, number> = {};
  for (const key of OBJ_KEYS) interPageSd[key] = pipePerPageMeans[key].length > 1 ? stdev(pipePerPageMeans[key]) : 0;
  return {
    refLabel: '', K, pages: pages.length,
    determinism: OBJ_KEYS.map((k) => statsFor(det, k)),
    pipeline: OBJ_KEYS.map((k) => statsFor(pipe, k)),
    interPageSd,
    wobble: { armsSeen: [...wobble.armsSeen].sort((a, b) => a - b), collabNull: wobble.collabNull, collabNum: wobble.collabNum, bothReachSeen: [...wobble.bothReachSeen].sort((a, b) => a - b) },
  };
}

async function newReadyPage(browser: Awaited<ReturnType<typeof chromium.launch>>, baseUrl: string): Promise<Page> {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.waitForFunction(() => { const ar = (window as any).__autoresearch; return !!ar && ar.scoreCurrentScene() != null; }, { timeout: 120_000 });
  // Warm-up apply (result discarded). On a fresh page the FIRST applyConfig races an async startup
  // profile-load that re-applies the built-in IRL-layout camera (z≈0.98), clobbering the requested
  // camera pose; the 2nd+ applies stick (verified). Consuming one apply here guarantees every REAL
  // candidate's camera takes effect. Root cause is the startup ordering in App.tsx; this is the
  // minimal harness-side guard that avoids touching the interactive twin's load sequence.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await page.evaluate(async () => { await (window as any).__autoresearch.applyConfig({ shapeSides: 4, size: 0.4, arms: 1, armBases: [{ x: 0, y: 0.3, yaw: -Math.PI / 2 }], camera: { x: 0, y: 0, z: 0.7, tilt: 0 }, taskDistribution: { kind: 'grid' } }, { fast: true }); });
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
    if (result) out.push({ ci, cfg, region, result, fidelity: fast ? 'fast' : 'full' });
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

  // #A6(a): measure scoring noise up front. Prefer a 2-ARM reference (the known wobble is arm/collab class).
  const K = Math.max(0, Number(arg('calibrate', '5')));
  let calib: CalibResult | null = null;
  if (K > 0 && candidates.length) {
    const ref = candidates.find((c) => c.arms === 2) ?? candidates[0];
    const refRegions = regionsFor(ref, blobRadius);
    const refRegion = refRegions.find((z) => z.label === 'center') ?? refRegions[0];
    console.log(`[autoresearch] calibrating noise: ${K} applies×scores (+${K} determinism scores) on ${pages.length} page(s)…`);
    calib = await calibrate(pages, ref, refRegion, K);
    calib.refLabel = `${ref.shapeSides}-gon r${ref.size.toFixed(2)} · ${ref.arms}arm · cam z${ref.camera.z.toFixed(2)} tilt${ref.camera.tilt}°`;
  }

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

  // #A8 single-rig: snapshot the UNIFORM fast-fidelity maximin (worst-region) score per candidate NOW,
  // before the per-region finalist re-score below mutates some entries to full — the cross-region
  // aggregate needs one consistent fidelity across every region. A rig's worst region defines it
  // (best worst-case rig that services centre AND every corner); only all-region-feasible rigs qualify.
  interface RigAgg { ci: number; cfg: Cfg; regions: number; scored: number; feasN: number; feasAll: boolean; tg: number; pc: number; }
  const rigByCi = new Map<number, RigAgg>();
  let srMissing = 0;
  {
    const byCi = new Map<number, RegionTrial[]>();
    for (const t of all) { const a = byCi.get(t.ci) ?? []; a.push(t); byCi.set(t.ci, a); }
    for (const [ci, ts] of byCi) {
      const nReg = regionsFor(ts[0].cfg, blobRadius).length;
      if (ts.length < nReg) srMissing++; // a region score returned null → can't be feasAll (logged below)
      rigByCi.set(ci, {
        ci, cfg: ts[0].cfg, regions: nReg, scored: ts.length,
        feasN: ts.filter((t) => t.result.feasible).length,
        feasAll: ts.length === nReg && ts.every((t) => t.result.feasible),
        tg: Math.min(...ts.map((t) => t.result.objectives.taskGrasp)),
        pc: Math.min(...ts.map((t) => t.result.objectives.perception)),
      });
    }
  }
  if (srMissing) console.log(`[autoresearch] single-rig: ${srMissing} candidate(s) had a null region score (excluded from feasAll).`);

  // group by region label → per-region candidate trials; full-fidelity re-score of each region's finalists.
  // NB: store the SAME RegionTrial objects (not copies) so the full-fidelity re-score below mutates the
  // entries that get serialised to results.json — otherwise results.json keeps the coarse triage scores
  // while summary.md/winners report the full-fidelity ones (a silent reproducibility gap).
  const byRegion = new Map<string, RegionTrial[]>();
  for (const t of all) { const a = byRegion.get(t.region.label) ?? []; a.push(t); byRegion.set(t.region.label, a); }

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
      if (r) { t.result = r; t.fidelity = 'full'; }
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
  // #A8 (DIRECTION 2c): fast maximin only RANKS — the answer must be uniform-FULL or it inherits the
  // triage bias. Take the top-K candidates by (feasible-region fraction, fast maximin), full-re-score
  // each across ALL its regions, then Pareto+knee on those FULL vectors.
  const SR_TOPK = 10;
  interface SrFull { cfg: Cfg; regions: number; feasN: number; feasAll: boolean; tg: number; pc: number; collab: number | null; }
  const srRanked = [...rigByCi.values()].sort((a, b) =>
    (b.feasN / b.regions - a.feasN / a.regions) || ((b.tg + b.pc) - (a.tg + a.pc)));
  const srFulls: SrFull[] = [];
  for (const cand of srRanked.slice(0, SR_TOPK)) {
    const regions = regionsFor(cand.cfg, blobRadius);
    await evalApply(page0, cand.cfg);
    const rs: Result[] = [];
    for (const region of regions) { const r = await evalScore(page0, region); if (r) rs.push(r); }
    if (!rs.length) continue;
    const collabs = rs.map((r) => r.objectives.collaboration);
    srFulls.push({
      cfg: cand.cfg, regions: regions.length,
      feasN: rs.filter((r) => r.feasible).length,
      feasAll: rs.length === regions.length && rs.every((r) => r.feasible),
      tg: Math.min(...rs.map((r) => r.objectives.taskGrasp)),
      pc: Math.min(...rs.map((r) => r.objectives.perception)),
      collab: collabs.every((c) => c != null) ? Math.min(...(collabs as number[])) : null,
    });
  }
  const srTrials: Trial[] = srFulls.filter((e) => e.feasAll).map((e) => ({
    cfg: e.cfg, result: { feasible: true, failed: [], objectives: { taskGrasp: e.tg, perception: e.pc, collaboration: e.collab }, penalty: { torqueStrain: 0 }, raw: {} },
  }));
  const srFront = paretoFront(srTrials);
  const srWinner = knee(srFront);
  const srWinnerFull = srWinner ? srFulls.find((e) => e.cfg === srWinner.cfg) ?? null : null;
  const srClosest = srFulls.length ? srFulls.reduce((a, b) => (b.feasN / b.regions > a.feasN / a.regions ? b : a)) : null;
  await browser.close();

  // report: per-region pareto csv + a cross-region summary (does the winner change by region?).
  mkdirSync(out, { recursive: true });
  // results.json carries every region-trial at its scored fidelity: 'fast' for the triage majority,
  // 'full' for the per-region Pareto finalists re-scored above (so the reported winners ARE reproducible
  // from this file — recompute the front from the 'full' entries).
  writeFileSync(`${out}/results.json`, JSON.stringify(all.map((t) => ({ ci: t.ci, region: t.region.label, fidelity: t.fidelity, cfg: t.cfg, result: t.result })), null, 2));
  const summary: string[] = ['# /autoresearch — per-region winners', ''];
  const cfgLabel = (c: Cfg) => `${c.shapeSides}-gon r${c.size.toFixed(2)} · ${c.arms}arm · cam z${c.camera.z.toFixed(2)} tilt${c.camera.tilt}°`;

  // #A6(a) calibration: report measured scoring noise so "within noise" claims are checkable. The
  // PIPELINE σ (re-apply per score) is the band that matters; determinism σ (≈0) is a sanity check.
  if (calib) {
    const pband = Math.max(...calib.pipeline.map((r) => (Number.isFinite(r.sd) ? r.sd : 0)),
      ...Object.values(calib.interPageSd));
    const w = calib.wobble;
    summary.push('## Calibration — scoring noise',
      `_reference = ${calib.refLabel}, full fidelity, K=${calib.K}× × ${calib.pages} page(s)_`, '',
      '| objective | pipeline mean | pipeline σ | min | max | inter-page σ | determinism σ |',
      '|---|---|---|---|---|---|---|',
      ...OBJ_KEYS.map((k, j) => `| ${k} | ${f3(calib!.pipeline[j].mean)} | ${f3(calib!.pipeline[j].sd)} | ${f3(calib!.pipeline[j].min)} | ${f3(calib!.pipeline[j].max)} | ${f3(calib!.interPageSd[k])} | ${f3(calib!.determinism[j].sd)} |`),
      '',
      `Pipeline noise band ≈ **±${f3(2 * pband)}** (2σ over the noisiest objective, apply→settle variance). ` +
      `Determinism σ≈0 confirms the scorer is repeatable on a settled scene; the pipeline band is what gates winner ties.`,
      `Instantiation wobble: raw.arms seen ${JSON.stringify(w.armsSeen)}, bothReachFrac seen ${JSON.stringify(w.bothReachSeen)}, ` +
      `collaboration null×${w.collabNull} / numeric×${w.collabNum}${w.collabNull > 0 && w.collabNum > 0 ? ' ⚠️ 2nd-arm instantiation is UNSTABLE across re-applies' : ' (stable)'}.`, '');
  }

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
  // #A8 single-rig section: the computed best-worst-case rig (full-fidelity maximin across all regions).
  summary.push('## Single-rig (computed) — best worst-case across all regions',
    `_top-${SR_TOPK} by fast maximin, re-scored at FULL fidelity, then Pareto+knee (DIRECTION 2c)_`);
  if (srWinner && srWinnerFull) {
    writeFileSync(`${out}/winner-single-rig.json`, JSON.stringify(srWinner.cfg, null, 2));
    summary.push(
      `- **rig:** ${cfgLabel(srWinner.cfg)} → winner-single-rig.json`,
      `- **maximin @ full:** taskGrasp ${f3(srWinnerFull.tg)}, perception ${f3(srWinnerFull.pc)}${srWinnerFull.collab != null ? `, collab ${f3(srWinnerFull.collab)}` : ''} (feasible in ${srWinnerFull.feasN}/${srWinnerFull.regions} regions)`,
      `- Pareto front = ${srFront.length} of ${srTrials.length} all-region-feasible rig(s) (top-${SR_TOPK} full-re-scored)${srFront.length <= 2 ? ' — small front; knee tie-break (mean-norm→raw-sum) is deterministic (DIRECTION 2)' : ''}.`,
      '- Reproduce: per candidate take min objective across regions, keep all-region-feasible, full-re-score, Pareto+knee.', '');
  } else {
    summary.push(
      `- _no rig is feasible in EVERY region at full fidelity (top-${SR_TOPK} contenders re-scored)._`,
      srClosest ? `- closest: ${cfgLabel(srClosest.cfg)} — feasible in ${srClosest.feasN}/${srClosest.regions} regions (maximin tg ${f3(srClosest.tg)}, pc ${f3(srClosest.pc)}).` : '- _no feasible region data._', '');
  }

  writeFileSync(`${out}/summary.md`, summary.join('\n'));
  console.log(`[autoresearch] ${all.length} region-trials · ${byRegion.size} regions${srWinner ? ' · single-rig ' + cfgLabel(srWinner.cfg) : ''} · wrote results.json, region-*.csv, summary.md to ${out}`);
}

main().catch((e) => { console.error('[autoresearch] failed:', e); process.exit(1); });
