/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — Pareto ranking over scored trials. Pure.
 */
import type { Cfg, Result } from './types';
import { dominates } from './scoreConfig';

export interface Trial { cfg: Cfg; result: Result; }

/** The non-dominated, FEASIBLE trials (the Pareto front). Generic so callers keep their richer trial
 *  type (e.g. RegionTrial) through the front — important when the caller mutates front entries. */
export function paretoFront<T extends Trial>(trials: T[]): T[] {
  const feasible = trials.filter((t) => t.result.feasible);
  return feasible.filter((a) => !feasible.some((b) => b !== a && dominates(b.result, a.result)));
}

/** A single "recommended" trial from a front: the knee = max of the minimum normalized objective
 *  (the most balanced point — best worst-objective after min-max normalizing each objective across the front). */
export function knee<T extends Trial>(front: T[]): T | null {
  if (front.length === 0) return null;
  if (front.length === 1) return front[0];
  const keys: Array<'taskGrasp' | 'perception' | 'collaboration'> = ['taskGrasp', 'perception', 'collaboration'];
  // per-objective min/max across the front (skip collaboration if any trial lacks it)
  const useCollab = front.every((t) => t.result.objectives.collaboration != null);
  const active = keys.filter((k) => k !== 'collaboration' || useCollab);
  const lo: Record<string, number> = {}, hi: Record<string, number> = {};
  for (const k of active) {
    const vals = front.map((t) => t.result.objectives[k] as number);
    lo[k] = Math.min(...vals); hi[k] = Math.max(...vals);
  }
  // Primary key = worst normalized objective (the knee). TIE-BREAK = highest MEAN normalized objective:
  // a 2-point front gives BOTH endpoints worst-norm 0 (each is min on some objective), so without a
  // tie-break array order would decide the winner — non-deterministic and wrong (DIRECTION 2). Mean-norm
  // picks the more balanced of the tied points deterministically and order-independently.
  let best: T | null = null, bestWorst = -Infinity, bestMean = -Infinity, bestRaw = -Infinity;
  const EPS = 1e-12;
  for (const t of front) {
    let worst = Infinity, normSum = 0, rawSum = 0;
    for (const k of active) {
      const v = t.result.objectives[k] as number;
      const span = hi[k] - lo[k];
      const norm = span > 1e-9 ? (v - lo[k]) / span : 1; // all-equal objective → neutral 1
      if (norm < worst) worst = norm;
      normSum += norm; rawSum += v;
    }
    const meanNorm = normSum / active.length;
    // Lexicographic, deterministic: worst-norm, then mean-norm, then raw objective sum. A 2-objective
    // 2-point front is symmetric in normalized space (both (1,0)/(0,1) → equal worst AND mean), so the
    // raw-sum tier is what makes the pick order-independent there. (DIRECTION 2)
    const better = worst > bestWorst + EPS
      || (Math.abs(worst - bestWorst) <= EPS && (meanNorm > bestMean + EPS
        || (Math.abs(meanNorm - bestMean) <= EPS && rawSum > bestRaw + EPS)));
    if (better) { bestWorst = worst; bestMean = meanNorm; bestRaw = rawSum; best = t; }
  }
  return best;
}
