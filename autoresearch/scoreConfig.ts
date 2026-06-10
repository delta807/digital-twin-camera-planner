/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — the PURE scorer. MetricsBag → Result. No app/Three/MuJoCo deps, so it's unit-testable
 * in isolation. The live twin (window hook) gathers the MetricsBag; this file only does the math.
 * Contract + rationale: tasks/autoresearch_scoreconfig.md.
 */
import type { MetricsBag, Result, ScoreParams } from './types';

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// D435i usable-depth band (datasheet 337029-005): MinZ ~0.195 m @848×480; depth degrades badly past ~2 m.
const DEPTH_MIN_Z = 0.17;
const DEPTH_MAX_Z = 2.0;

/**
 * Score a config from its gathered metrics. Pure + deterministic: same bag → same result.
 *  • 3 objectives (maximize, 0..1): taskGrasp, perception, collaboration(null if 1 arm).
 *  • 4 hard constraints → `feasible` gate.
 *  • torque penalty folded as a small discount into the manipulation objectives.
 */
export function scoreConfig(bag: MetricsBag, params: ScoreParams): Result {
  const z = bag.zonePoints;

  // ── Objectives ────────────────────────────────────────────────────────────
  // O1 taskGrasp — dexterity-weighted graspable coverage (dex is already 0 where not graspable).
  const taskGraspRaw = mean(z.map((p) => (p.graspable ? p.dex : 0)));

  // O2 perception — visible AND sharp enough in BOTH channels (RGB × depth). depth semantic (#A5b):
  //   NaN      → depth channel not computed for this scene → factor 1 (skip; don't penalize).
  //   Infinity → point is RGB-visible but has NO depth coverage → factor 0 (penalize the real gap; the
  //              old code returned 1 here, silently giving undepthable points a free pass).
  //   finite   → measured: how sharp depth is vs the target.
  const perception = mean(z.map((p) => {
    if (!p.visible) return 0;
    const rgb = clamp01(params.RGB_GSD_TARGET / p.gsdRGB);
    const depth = Number.isNaN(p.gsdDepth) ? 1 : (Number.isFinite(p.gsdDepth) ? clamp01(params.DEPTH_GSD_TARGET / p.gsdDepth) : 0);
    return rgb * depth;
  }));

  // O3 collaboration — dexterity-weighted overlap over cells BOTH arms reach (null for 1 arm).
  const both = z.filter((p) => p.bothReach);
  const collaborationRaw = bag.arms < 2 ? null : mean(both.map((p) => p.collabQuality));

  // ── Torque penalty (only over graspable cells; a gentle discount, not a gate) ──
  const graspable = z.filter((p) => p.graspable);
  const torqueStrain = clamp01(mean(graspable.map((p) => 1 - p.headroom)));
  const discount = 1 - params.lambda * torqueStrain;
  const taskGrasp = clamp01(taskGraspRaw * discount);
  const collaboration = collaborationRaw == null ? null : clamp01(collaborationRaw * discount);

  // ── Hard constraints → feasibility gate ───────────────────────────────────
  const failed: string[] = [];
  if (!bag.collisionFree) failed.push('C1 noCollision: arms overlap each other / table / post');
  if (bag.cameraZ < DEPTH_MIN_Z || bag.cameraZ > DEPTH_MAX_Z) failed.push(`C2 depthInRange: camera z=${bag.cameraZ.toFixed(2)}m outside [${DEPTH_MIN_Z}, ${DEPTH_MAX_Z}]`);
  // C3/C4 over the DESIGNATED object blob when given: require MOST of the cluster serviceable (a blob is a
  // group of objects, and coarse-triage sampling undercounts — demanding 100% guarantees false infeasibles).
  // Without a blob, fall back to "≥1 cell graspable/visible somewhere".
  const TASK_MIN = 0.5;
  const reachFrac = bag.taskPoints && bag.taskPoints.length ? bag.taskPoints.filter((t) => t.graspable).length / bag.taskPoints.length : (z.some((p) => p.graspable) ? 1 : 0);
  const visFrac = bag.taskPoints && bag.taskPoints.length ? bag.taskPoints.filter((t) => t.visible).length / bag.taskPoints.length : (z.some((p) => p.visible) ? 1 : 0);
  if (reachFrac < TASK_MIN) failed.push(`C3 reachable: only ${Math.round(reachFrac * 100)}% of the object blob is graspable (<${TASK_MIN * 100}%)`);
  if (visFrac < TASK_MIN) failed.push(`C4 visible: only ${Math.round(visFrac * 100)}% of the object blob is camera-visible (<${TASK_MIN * 100}%)`);

  return {
    feasible: failed.length === 0,
    failed,
    objectives: { taskGrasp, perception, collaboration },
    penalty: { torqueStrain },
    raw: {
      taskGraspRaw,
      collaborationRaw: collaborationRaw ?? -1,
      torqueStrain,
      zonePoints: z.length,
      graspableFrac: z.length ? graspable.length / z.length : 0,
      visibleFrac: z.length ? z.filter((p) => p.visible).length / z.length : 0,
      bothReachFrac: z.length ? both.length / z.length : 0,
      arms: bag.arms,
      cameraZ: bag.cameraZ,
    },
  };
}

/** Pareto helper: does A dominate B? (≥ on every objective, > on at least one; collaboration ignored when null). */
export function dominates(a: Result, b: Result): boolean {
  if (!a.feasible) return false;
  if (!b.feasible) return true;
  const keys: Array<'taskGrasp' | 'perception' | 'collaboration'> = ['taskGrasp', 'perception', 'collaboration'];
  let strictlyBetter = false;
  for (const k of keys) {
    const av = a.objectives[k], bv = b.objectives[k];
    if (av == null || bv == null) continue; // skip collaboration when either lacks it
    if (av < bv) return false;
    if (av > bv) strictlyBetter = true;
  }
  return strictlyBetter;
}
