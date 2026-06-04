/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { MujocoData, MujocoModel, MujocoModule } from './types';

/**
 * NumericIk — robot-agnostic numeric inverse kinematics (position, optionally + gripper-down).
 *
 * The SO-101 has no closed-form IK (5-DOF, no spherical wrist), so we use the loaded MuJoCo
 * model itself as the forward-kinematics oracle: perturb each driving joint, mj_forward, read
 * the TCP site delta → that's a finite-difference Jacobian. A damped-least-squares step
 * (Levenberg–Marquardt, N×N normal form) drives the TCP toward a 3-D target, and when
 * `downWeight > 0` also drives the gripper's approach axis toward straight-down (a 6×N Jacobian) —
 * which makes the base rotate to face side targets and orients for a top-down grasp. All work
 * happens on a SCRATCH MjData so the live arm is never disturbed. ~1–10 ms/solve, no new deps.
 * (Parameters per the SO-101 IK research: λ=0.05, dq=1e-4, 24 iters, 1 mm tol, 0.2 rad clamp.)
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
   * @param target     world-space TCP target
   * @param seed       current joint angles for the N driving joints (continuity → avoids minima)
   * @param liveQpos   full live qpos so non-driving joints match the real arm
   * @param downWeight if > 0, also drive the gripper's APPROACH axis toward straight-down. This is
   *                   what makes the arm ROTATE to face a side target (you can't reach sideways AND
   *                   point down without turning the base) and orients it for a real top-down grasp.
   * @returns the solved joint angles and whether the position target was reached (within OK_TOL).
   */
  solve(target: THREE.Vector3, seed: number[], liveQpos?: ArrayLike<number>, downWeight = 0): { q: number[]; ok: boolean } {
    const N = this.qadr.length;
    const d = this.scratch;
    if (liveQpos) for (let i = 0; i < d.qpos.length && i < liveQpos.length; i++) d.qpos[i] = liveQpos[i];
    const q = seed.slice();
    const W = downWeight;

    // FK oracle → [px,py,pz, ax,ay,az] where a = the gripper APPROACH axis in world coords.
    // Fingers extend along the tcp site's -localY, so approach = -(column 1 of site_xmat).
    const fk = (): number[] => {
      for (let j = 0; j < N; j++) d.qpos[this.qadr[j]] = q[j];
      this.mujoco.mj_forward(this.model, d);
      const pi = this.tcpSiteId * 3, mi = this.tcpSiteId * 9;
      return [d.site_xpos[pi], d.site_xpos[pi + 1], d.site_xpos[pi + 2],
        -d.site_xmat[mi + 1], -d.site_xmat[mi + 4], -d.site_xmat[mi + 7]];
    };

    let errPos = Infinity;
    for (let iter = 0; iter < this.MAX_ITERS; iter++) {
      const o = fk();
      // 6-vector error: position + (weighted) approach-axis-vs-down.
      const e = [target.x - o[0], target.y - o[1], target.z - o[2],
        W * (0 - o[3]), W * (0 - o[4]), W * (-1 - o[5])];
      errPos = Math.hypot(e[0], e[1], e[2]);
      const errOri = Math.hypot(e[3], e[4], e[5]);
      if (errPos < this.TOL && (W === 0 || errOri < W * 0.25)) return { q, ok: true };

      // Finite-difference 6×N Jacobian (orientation rows pre-scaled by W).
      const J: number[][] = [[], [], [], [], [], []];
      for (let j = 0; j < N; j++) {
        const saved = q[j];
        q[j] = saved + this.DQ;
        const oo = fk();
        q[j] = saved;
        J[0][j] = (oo[0] - o[0]) / this.DQ;
        J[1][j] = (oo[1] - o[1]) / this.DQ;
        J[2][j] = (oo[2] - o[2]) / this.DQ;
        J[3][j] = W * (oo[3] - o[3]) / this.DQ;
        J[4][j] = W * (oo[4] - o[4]) / this.DQ;
        J[5][j] = W * (oo[5] - o[5]) / this.DQ;
      }

      // Damped least squares, N×N normal form: (JᵀJ + λ²I) dq = Jᵀe.
      const A: number[][] = Array.from({ length: N }, () => new Array(N).fill(0));
      const b: number[] = new Array(N).fill(0);
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) { let s = 0; for (let k = 0; k < 6; k++) s += J[k][r] * J[k][c]; A[r][c] = s; }
        A[r][r] += this.LAMBDA * this.LAMBDA;
        let s = 0; for (let k = 0; k < 6; k++) s += J[k][r] * e[k]; b[r] = s;
      }
      const dq = solveLinear(A, b);
      if (!dq) break; // degenerate; bail with current best

      const dqNorm = Math.hypot(...dq);
      if (dqNorm > this.STEP_CLAMP) for (let j = 0; j < N; j++) dq[j] *= this.STEP_CLAMP / dqNorm;
      for (let j = 0; j < N; j++) q[j] = Math.min(this.hi[j], Math.max(this.lo[j], q[j] + dq[j]));
    }
    // DLS leaves the arm at the closest reachable pose, which is the desired UX.
    return { q, ok: errPos < this.OK_TOL };
  }
}

/** Solve A x = b for small N×N A via Gaussian elimination + partial pivoting. Null if singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]); // augmented
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let c = col; c <= n; c++) M[col][c] /= d;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}
