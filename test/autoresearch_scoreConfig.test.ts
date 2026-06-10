/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect } from 'vitest';
import { scoreConfig, dominates } from '../autoresearch/scoreConfig';
import { paretoFront, knee, type Trial } from '../autoresearch/pareto';
import { DEFAULT_PARAMS, type MetricsBag, type SamplePoint, type Cfg } from '../autoresearch/types';

const pt = (o: Partial<SamplePoint>): SamplePoint => ({
  graspable: true, dex: 0.8, headroom: 1, bothReach: false, collabQuality: 0,
  visible: true, gsdRGB: 0.4, gsdDepth: NaN, ...o,
});
const bag = (o: Partial<MetricsBag>): MetricsBag => ({
  arms: 1, cameraZ: 0.85, collisionFree: true, zonePoints: [pt({})], ...o,
});

describe('scoreConfig', () => {
  it('feasible scene scores in [0,1] with collaboration null for 1 arm', () => {
    const r = scoreConfig(bag({ arms: 1 }), DEFAULT_PARAMS);
    expect(r.feasible).toBe(true);
    expect(r.objectives.collaboration).toBeNull();
    expect(r.objectives.taskGrasp).toBeGreaterThan(0);
    expect(r.objectives.taskGrasp).toBeLessThanOrEqual(1);
  });

  it('stricter RGB GSD target lowers perception (monotonic)', () => {
    const b = bag({ zonePoints: [pt({ gsdRGB: 0.6 })] });
    const loose = scoreConfig(b, { ...DEFAULT_PARAMS, RGB_GSD_TARGET: 0.9 }).objectives.perception;
    const strict = scoreConfig(b, { ...DEFAULT_PARAMS, RGB_GSD_TARGET: 0.3 }).objectives.perception;
    expect(strict).toBeLessThan(loose);
  });

  it('depth-GSD semantic (#A5b): NaN skips, Infinity penalizes, finite measures', () => {
    // gsdRGB 0.3 vs target 0.5 → rgb factor clamps to 1, so perception == the depth factor alone.
    const perc = (gsdDepth: number) => scoreConfig(bag({ zonePoints: [pt({ gsdRGB: 0.3, gsdDepth })] }), DEFAULT_PARAMS).objectives.perception;
    expect(perc(NaN)).toBeCloseTo(1, 5);                 // channel absent → no penalty
    expect(perc(DEFAULT_PARAMS.DEPTH_GSD_TARGET)).toBeCloseTo(1, 5); // at target → full credit
    expect(perc(Infinity)).toBeCloseTo(0, 5);            // RGB-visible but no depth → penalized (was a free pass)
    expect(perc(Infinity)).toBeLessThan(perc(NaN));      // the fix: Infinity ≠ NaN anymore
  });

  it('torque penalty (λ>0) discounts taskGrasp vs λ=0', () => {
    const b = bag({ zonePoints: [pt({ dex: 0.9, headroom: 0.5 })] }); // strained
    const off = scoreConfig(b, { ...DEFAULT_PARAMS, lambda: 0 }).objectives.taskGrasp;
    const on = scoreConfig(b, { ...DEFAULT_PARAMS, lambda: 0.2 }).objectives.taskGrasp;
    expect(on).toBeLessThan(off);
  });

  it('collaboration appears for 2 arms over both-reach cells', () => {
    const b = bag({ arms: 2, zonePoints: [pt({ bothReach: true, collabQuality: 0.7 })] });
    const r = scoreConfig(b, DEFAULT_PARAMS);
    expect(r.objectives.collaboration).not.toBeNull();
    expect(r.objectives.collaboration!).toBeGreaterThan(0);
  });

  it('constraints gate feasibility', () => {
    expect(scoreConfig(bag({ cameraZ: 0.05 }), DEFAULT_PARAMS).feasible).toBe(false);       // C2 depth
    expect(scoreConfig(bag({ collisionFree: false }), DEFAULT_PARAMS).feasible).toBe(false); // C1 collision
    const r = scoreConfig(bag({ taskPoints: [{ graspable: false, visible: true }] }), DEFAULT_PARAMS);
    expect(r.feasible).toBe(false);                                                          // C3 reachable
    expect(r.failed.join(' ')).toMatch(/reachable/);
  });
});

describe('pareto', () => {
  const mk = (taskGrasp: number, perception: number, feasible = true): Trial => ({
    cfg: {} as Cfg,
    result: { feasible, failed: [], objectives: { taskGrasp, perception, collaboration: null }, penalty: { torqueStrain: 0 }, raw: {} },
  });

  it('dominates: strictly-better point dominates', () => {
    expect(dominates(mk(0.8, 0.8).result, mk(0.5, 0.5).result)).toBe(true);
    expect(dominates(mk(0.8, 0.4).result, mk(0.5, 0.6).result)).toBe(false); // trade-off, neither dominates
  });

  it('paretoFront drops dominated + infeasible', () => {
    // (0.5,0.5) is NOT dominated by (0.8,0.4) or (0.4,0.8) — neither beats it on BOTH axes — so it's on
    // the front too. (0.6,0.6) DOES dominate (0.5,0.5). Infeasible (0.9,0.9) is always dropped.
    const front = paretoFront([mk(0.8, 0.4), mk(0.4, 0.8), mk(0.5, 0.5), mk(0.9, 0.9, false)]);
    expect(front).toHaveLength(3);
    expect(paretoFront([mk(0.6, 0.6), mk(0.5, 0.5)])).toHaveLength(1);  // strict domination drops the worse
    expect(knee(front)).not.toBeNull();
  });

  it('knee prefers the balanced interior point over the extremes', () => {
    const front = [mk(0.9, 0.1), mk(0.1, 0.9), mk(0.5, 0.5)];
    expect(knee(front)).toBe(front[2]); // worst-norm 0.5 beats the endpoints' 0
  });

  it('knee 2-point front: deterministic + order-independent (DIRECTION 2)', () => {
    // Symmetric in normalized space: A=(1,0), B=(0,1) → equal worst-norm AND mean-norm. Without the
    // raw-sum tier the winner would flip with array order. B has the higher raw total (0.71 vs 0.70).
    const A = mk(0.30, 0.40), B = mk(0.26, 0.45);
    expect(knee([A, B])).toBe(knee([B, A])); // order-independent
    expect(knee([A, B])).toBe(B);            // picks higher total value, not array position
  });

  it('knee is deterministic on an all-equal front', () => {
    const a = mk(0.5, 0.5), b = mk(0.5, 0.5);
    expect(knee([a, b])).toBe(a);            // span 0 → neutral; first stays best, never undefined
  });
});
