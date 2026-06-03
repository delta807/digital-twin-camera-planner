/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { MujocoData, MujocoModel, MujocoModule } from './types';

/**
 * NumericIk — robot-agnostic position-only inverse kinematics.
 *
 * The SO-101 has no closed-form IK (5-DOF, no spherical wrist), so we use the loaded MuJoCo
 * model itself as the forward-kinematics oracle: perturb each driving joint, mj_forward, read
 * the TCP site delta → that's a finite-difference Jacobian. Then a damped-least-squares step
 * (Levenberg–Marquardt) drives the TCP toward a 3-D target, clamped to joint limits. All work
 * happens on a SCRATCH MjData so the live arm is never disturbed. ~1–10 ms/solve, no new deps.
 * (Parameters per the SO-101 IK research: λ=0.05, dq=1e-4, 20 iters, 1 mm tol, 0.2 rad clamp.)
 */
export class NumericIk {
  private readonly scratch: MujocoData;

  // Tunables (see research). Pulled out so behaviour is easy to adjust.
  private readonly LAMBDA = 0.05;   // DLS damping (singularity-robust)
  private readonly DQ = 1e-4;       // finite-difference perturbation, rad
  private readonly MAX_ITERS = 24;
  private readonly TOL = 1e-3;      // converged: 1 mm
  private readonly OK_TOL = 0.02;   // "reachable / good enough": 2 cm
  private readonly STEP_CLAMP = 0.2; // max joint move per iteration, rad

  constructor(
    private readonly mujoco: MujocoModule,
    private readonly model: MujocoModel,
    private readonly tcpSiteId: number,
    private readonly qadr: number[], // qpos addresses of the N position-driving joints
    private readonly lo: number[],   // per-joint lower limits
    private readonly hi: number[],   // per-joint upper limits
  ) {
    this.scratch = new mujoco.MjData(model);
  }

  dispose() { this.scratch.delete(); }

  /**
   * @param target world-space TCP target
   * @param seed   current joint angles for the N driving joints (continuity → avoids local minima)
   * @returns the solved joint angles and whether the target was reached (within OK_TOL).
   */
  solve(target: THREE.Vector3, seed: number[], liveQpos?: ArrayLike<number>): { q: number[]; ok: boolean } {
    const N = this.qadr.length;
    const d = this.scratch;
    // Initialise the scratch with the live full configuration so NON-driving joints (Wrist_Roll,
    // Jaw) match the real arm — the solver then models the ACTUAL TCP, not a default-zero variant.
    // Only the N driving joints are searched below.
    if (liveQpos) for (let i = 0; i < d.qpos.length && i < liveQpos.length; i++) d.qpos[i] = liveQpos[i];
    const q = seed.slice();

    const tcp = (): [number, number, number] => {
      for (let j = 0; j < N; j++) d.qpos[this.qadr[j]] = q[j];
      this.mujoco.mj_forward(this.model, d);
      const i = this.tcpSiteId * 3;
      return [d.site_xpos[i], d.site_xpos[i + 1], d.site_xpos[i + 2]];
    };

    let err = Infinity;
    for (let iter = 0; iter < this.MAX_ITERS; iter++) {
      const p = tcp();
      const e: [number, number, number] = [target.x - p[0], target.y - p[1], target.z - p[2]];
      err = Math.hypot(e[0], e[1], e[2]);
      if (err < this.TOL) return { q, ok: true };

      // Finite-difference 3×N translational Jacobian.
      const J: number[][] = [[], [], []];
      for (let j = 0; j < N; j++) {
        const saved = q[j];
        q[j] = saved + this.DQ;
        const pp = tcp();
        q[j] = saved;
        J[0][j] = (pp[0] - p[0]) / this.DQ;
        J[1][j] = (pp[1] - p[1]) / this.DQ;
        J[2][j] = (pp[2] - p[2]) / this.DQ;
      }

      // A = J Jᵀ + λ²I  (3×3) — small, invert in closed form.
      const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) {
        let s = 0; for (let j = 0; j < N; j++) s += J[r][j] * J[c][j];
        A[r][c] = s;
      }
      const l2 = this.LAMBDA * this.LAMBDA;
      A[0][0] += l2; A[1][1] += l2; A[2][2] += l2;
      const Ai = inv3(A);
      if (!Ai) break; // degenerate; bail with current best

      // dq = Jᵀ A⁻¹ e
      const y: [number, number, number] = [
        Ai[0][0] * e[0] + Ai[0][1] * e[1] + Ai[0][2] * e[2],
        Ai[1][0] * e[0] + Ai[1][1] * e[1] + Ai[1][2] * e[2],
        Ai[2][0] * e[0] + Ai[2][1] * e[1] + Ai[2][2] * e[2],
      ];
      const dq: number[] = [];
      for (let j = 0; j < N; j++) dq[j] = J[0][j] * y[0] + J[1][j] * y[1] + J[2][j] * y[2];

      // Clamp the step (stability near singularities), integrate, clamp to joint limits.
      const dqNorm = Math.hypot(...dq);
      if (dqNorm > this.STEP_CLAMP) for (let j = 0; j < N; j++) dq[j] *= this.STEP_CLAMP / dqNorm;
      for (let j = 0; j < N; j++) q[j] = Math.min(this.hi[j], Math.max(this.lo[j], q[j] + dq[j]));
    }
    // DLS leaves the arm pointing at the closest reachable point, which is the desired UX.
    return { q, ok: err < this.OK_TOL };
  }
}

/** Closed-form 3×3 inverse; returns null if (near-)singular. */
function inv3(m: number[][]): number[][] | null {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [A * inv, (c * h - b * i) * inv, (b * f - c * e) * inv],
    [B * inv, (a * i - c * g) * inv, (c * d - a * f) * inv],
    [C * inv, (b * g - a * h) * inv, (a * e - b * d) * inv],
  ];
}
