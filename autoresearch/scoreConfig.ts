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

  // O2 perception — visible AND sharp enough in BOTH channels (RGB × depth). depth skipped if NaN (slice 1).
  const perception = mean(z.map((p) => {
    if (!p.visible) return 0;
    const rgb = clamp01(params.RGB_GSD_TARGET / p.gsdRGB);
    const depth = Number.isFinite(p.gsdDepth) ? clamp01(params.DEPTH_GSD_TARGET / p.gsdDepth) : 1; // 1 = channel unavailable, don't penalize
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
  // C3/C4 over the DESIGNATED objects when given; else over the zone (≥1 graspable / visible somewhere).
  const reachOK = bag.taskPoints ? bag.taskPoints.every((t) => t.graspable) : z.some((p) => p.graspable);
  const visOK = bag.taskPoints ? bag.taskPoints.every((t) => t.visible) : z.some((p) => p.visible);
  if (!reachOK) failed.push('C3 reachable: a designated task object is not graspable');
  if (!visOK) failed.push('C4 visible: a designated task object is not camera-visible');

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
