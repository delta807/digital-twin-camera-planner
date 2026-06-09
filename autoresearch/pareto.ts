/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — Pareto ranking over scored trials. Pure.
 */
import type { Cfg, Result } from './types';
import { dominates } from './scoreConfig';

export interface Trial { cfg: Cfg; result: Result; }

/** The non-dominated, FEASIBLE trials (the Pareto front). */
export function paretoFront(trials: Trial[]): Trial[] {
  const feasible = trials.filter((t) => t.result.feasible);
  return feasible.filter((a) => !feasible.some((b) => b !== a && dominates(b.result, a.result)));
}

/** A single "recommended" trial from a front: the knee = max of the minimum normalized objective
 *  (the most balanced point — best worst-objective after min-max normalizing each objective across the front). */
export function knee(front: Trial[]): Trial | null {
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
  let best: Trial | null = null, bestScore = -Infinity;
  for (const t of front) {
    let worst = Infinity;
    for (const k of active) {
      const v = t.result.objectives[k] as number;
      const span = hi[k] - lo[k];
      const norm = span > 1e-9 ? (v - lo[k]) / span : 1; // all-equal objective → neutral 1
      if (norm < worst) worst = norm;
    }
    if (worst > bestScore) { bestScore = worst; best = t; }
  }
  return best;
}
