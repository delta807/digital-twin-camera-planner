/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * /autoresearch — shared types. See tasks/autoresearch_scoreconfig.md for the full contract.
 */

/** The physical knobs the optimizer turns. */
export interface Cfg {
  shapeSides: number;                 // 3..8 (table polygon)
  size: number;                       // m, worktop circumradius (drives length/width)
  arms: 1 | 2;
  armBases: Array<{ x: number; y: number; yaw: number }>; // length === arms
  camera: { x: number; y: number; z: number; tilt: number };
  taskDistribution: { kind: 'grid' | 'objects'; points?: Array<[number, number]> };
  forbiddenZones?: Array<{ x: number; y: number; r: number }>;
}

/** Objective-parameters (FIXED per inner run; varied only by the outer sensitivity sweep). */
export interface ScoreParams {
  ZONE_FRAC: number;        // 0.6..0.8 — central fraction counted as the work area (grid taskDistribution only)
  RGB_GSD_TARGET: number;   // mm/px, "sharp enough" threshold (D435i RGB band 0.3..0.9)
  DEPTH_GSD_TARGET: number; // mm/px, depth-channel threshold (D435i depth band 0.6..1.9)
  lambda: number;           // 0..~0.4 torque-penalty weight (or 0 to disable)
}

export const DEFAULT_PARAMS: ScoreParams = { ZONE_FRAC: 0.7, RGB_GSD_TARGET: 0.5, DEPTH_GSD_TARGET: 1.1, lambda: 0.2 };

/** One sampled point in the object zone, with every per-cell reading the scorer needs. */
export interface SamplePoint {
  graspable: boolean;   // ≥1 arm can grasp it top-down
  dex: number;          // best manipulability (inverse condition number) 0..1; 0 if not graspable
  headroom: number;     // torque headroom 0..1 (1 = relaxed); 1 if unknown/not graspable
  bothReach: boolean;   // ≥2 arms can grasp it (collaboration candidate)
  collabQuality: number;// dexterity-weighted handoff quality 0..1; 0 if not bothReach
  visible: boolean;     // overhead camera sees it (in-frustum AND not occluded)
  gsdRGB: number;       // mm/px RGB at this point (Infinity if not visible)
  gsdDepth: number;     // mm/px depth at this point (NaN if depth channel not available yet)
}

/** Everything the PURE scorer needs — gathered from the live twin by the window hook. */
export interface MetricsBag {
  arms: number;
  cameraZ: number;
  collisionFree: boolean;                  // config-level: arms don't overlap each other/table/posts
  zonePoints: SamplePoint[];               // the object zone (objectives averaged over these)
  taskPoints?: Array<{ graspable: boolean; visible: boolean }>; // designated objects (hard reach/visible gate)
}

/** The scorer's output — the optimizer's contract. */
export interface Result {
  feasible: boolean;
  failed: string[];                        // which constraint(s) failed (empty if feasible)
  objectives: { taskGrasp: number; perception: number; collaboration: number | null }; // post-penalty, 0..1, maximize
  penalty: { torqueStrain: number };       // 0..1, lower better (already folded into objectives)
  raw: Record<string, number>;             // unweighted debug numbers
}
