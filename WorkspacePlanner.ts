/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { ArmInstance, MujocoData, MujocoModel, MujocoModule } from './types';

export interface SweptJoint { qposAdr: number; lo: number; hi: number; }

export interface PlannerToggles {
  outline: boolean;     // dashed max-range reach outline (per arm, color-coded) — default view
  reach: boolean;       // forward reachability heatmap (optional, denser detail)
  basePlacement: boolean; // inverse-reachability (where to mount) heatmap
  tasks: boolean;       // task-point markers
  baseDrag: boolean;    // show the draggable base gizmo
  blocked: boolean;     // red overlay: graspable cells lost to an obstacle (post / other arm)
}

export interface PlannerConfig {
  model: MujocoModel;
  mujoco: MujocoModule;
  tcpSiteId: number;
  sweptJoints: SweptJoint[];   // joints that determine TCP position (Rotation,Pitch,Elbow,Wrist_Pitch)
  zeroQposAdr: number[];       // remaining arm joints to hold at 0 (Wrist_Roll, Jaw)
  baseBodyId: number;          // arm Base body (for base-relative reach)
  taskBodyIds: number[];       // objects to cover
  mainCamera: THREE.Camera;
  domElement: HTMLElement;
  orbitControls: OrbitControls;
  onRelocate: (x: number, y: number) => void;
  baseSearchHalfX?: number;
  baseSearchHalfY?: number;
}

const CELL = 0.03;      // heatmap cell size, meters
const Z_BAND = 0.14;    // count configs whose TCP reaches within this height of the worktop
const TOPDOWN_MIN = 0.5; // cos(60°): keep configs whose gripper approach is within 60° of straight down
const MAX_TILES = 1024;
// Radial reach profile (the reach OUTLINE). A fixed-base arm's top-down reachable area is an
// annular fan, so we represent it as r(θ): min/max reachable radius per angular bin. This is
// GUARANTEED to render as a clean fan (no grid-marching / contour-tracing artefacts). We sweep the
// base-rotation joint finely (BASE_STEPS) so every angular bin is well-populated.
const ANG_BINS = 120;   // angular resolution of the fan (3° bins)
const BASE_STEPS = 160; // base-rotation joint samples (dominates the angular sweep)
const LINK_R = 0.035;   // arm link half-thickness (m) — capsule radius for collision tests
const SEG_SAMPLES = 3;  // points sampled along each arm link segment for the collision test

/**
 * WorkspacePlanner
 *
 * Answers two questions for an arm on the worktop, both from ONE forward-kinematics joint
 * sweep (no IK solver needed — works for any arm):
 *   • Forward reachability — "what can the arm reach from where it's mounted?" → a heatmap of
 *     tabletop cells colored by reachability index (how many joint configs reach each cell).
 *   • Inverse / base placement — "where should I mount it to cover my objects?" → translate the
 *     base-relative reachable set under every candidate mount and score task coverage.
 * Plus a draggable base gizmo that triggers a real model reload at the new mount point.
 */
export class WorkspacePlanner {
  readonly group = new THREE.Group();
  readonly gizmoHelper: THREE.Object3D;

  private cfg: PlannerConfig;
  private reachTiles: THREE.InstancedMesh;
  private baseTiles: THREE.InstancedMesh;
  // Obstacle-blocked cells: drawn as FULL-cell red quads so contiguous cells merge into one solid
  // footprint (the post + its shadow), while honestly staying sparse where blockage is sparse. A
  // radial fan was tried here but mis-renders a scattered blocked set as a starburst (blocked is a
  // 2D footprint, not a clean annulus like the reach fan).
  private blockedTiles: THREE.InstancedMesh;
  private taskMarkers = new THREE.Group();
  private bestMarker: THREE.Mesh;
  private baseDisc: THREE.Mesh;
  private control: TransformControls;

  private toggles: PlannerToggles = { outline: true, reach: false, basePlacement: false, tasks: false, baseDrag: false, blocked: true };

  // Per-arm dashed reach outlines (color-coded), and the arm placements driving them.
  private readonly outlineGroup = new THREE.Group();
  private arms: ArmInstance[] = [];
  private primaryYaw = 0;
  // Precision grasp fan, per arm. Index 0 (primary) = the categorical "precision" cyan so it matches
  // the overlay legend; the rest stay distinct so multiple arms' fans are tellable apart.
  private static readonly ARM_PALETTE = [0x2dd4cf, 0x6366f1, 0xf59e0b, 0xef4444, 0x10b981, 0xec4899];

  // Base-relative reachable cells: "di,dj" -> hit count. Reusable for inverse placement.
  // reachCells = PRECISION (gripper can point down → graspable); reachCellsMax = full reachable
  // footprint (the arm folds & swings ~340° even with a ±110° base, so this is nearly a ring).
  private reachCells = new Map<string, number>();
  private reachCellsMax = new Map<string, number>();
  // Radial reach profiles in the arm's LOCAL frame (base at origin, yaw 0): per angular bin, the
  // min & max reachable radius. radMax = full envelope; radPrec = top-down graspable fan.
  private radMax = makeRadial();
  private radPrec = makeRadial();
  // Per-arm radial profiles (each swept at its OWN base + obstacle set, so every arm's outline is
  // obstacle-aware in its own frame). radMax/radPrec above mirror the PRIMARY arm (base placement +
  // localForwardAngle read those).
  private armRadials = new Map<string, { radMax: Radial; radPrec: Radial }>();
  // Per-arm blocked cells (graspable but no collision-free config reaches them) → the red overlay.
  private armBlocked = new Map<string, Map<string, number>>();
  private baseX = 0;
  private baseY = 0;
  /** Result of the last base-placement pass, for the UI readout. */
  lastBaseResult: { x: number; y: number; covered: number; total: number } | null = null;

  /** Obstacle cylinders (world XY, z 0→zTop) the arm must not pass through — the camera/mount posts
   *  and other arms. Sweep configs whose links collide are dropped, so the ROM excludes regions the
   *  arm can't actually reach because something is in the way. World-frame, so accurate for the swept
   *  (primary) base; the base-relative cells are then reused for placement. */
  private obstacles: Array<{ x: number; y: number; r: number; zTop: number }> = [];
  private armBodies: number[] | null = null; // memoized arm subtree body ids (chain under baseBodyId)
  /** Last sweep's graspable-vs-blocked tally (primary arm), for the "% blocked" readout. */
  lastBlocked: { blocked: number; graspable: number } | null = null;

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(private scene: THREE.Scene, cfg: PlannerConfig) {
    this.cfg = cfg;
    this.reachTiles = this.makeTiles();
    this.baseTiles = this.makeTiles();
    this.blockedTiles = this.makeTiles(1.0); // full-cell quads → contiguous blocked cells read solid
    this.group.add(this.reachTiles, this.baseTiles, this.blockedTiles, this.taskMarkers, this.outlineGroup);

    // Best-mount marker: a thin ring laid flat on the worktop.
    this.bestMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.025, 0.04, 32),
      new THREE.MeshBasicMaterial({ color: 0x111827, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
    );
    this.bestMarker.visible = false;
    this.group.add(this.bestMarker);

    // Draggable base handle (disc at the arm base).
    this.baseDisc = new THREE.Mesh(
      new THREE.CircleGeometry(0.05, 32),
      new THREE.MeshBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    this.readBaseWorld();
    this.baseDisc.position.set(this.baseX, this.baseY, 0.006);
    this.group.add(this.baseDisc);

    this.control = new TransformControls(cfg.mainCamera, cfg.domElement);
    this.control.setMode('translate');
    this.control.setSpace('world');
    this.control.showZ = false; // base slides on the worktop plane
    this.control.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      cfg.orbitControls.enabled = !dragging;
      if (!dragging) cfg.onRelocate(this.baseDisc.position.x, this.baseDisc.position.y);
    });
    this.control.attach(this.baseDisc);
    this.gizmoHelper = this.control.getHelper();
    this.scene.add(this.group);
    this.scene.add(this.gizmoHelper);

    this.buildTaskMarkers();
    this.applyToggles();
  }

  setToggles(t: Partial<PlannerToggles>) {
    this.toggles = { ...this.toggles, ...t };
    this.applyToggles();
  }

  /** Update the base-placement search half-extents (e.g. when the worktop is resized). */
  setSearchBounds(halfX: number, halfY: number) {
    this.cfg.baseSearchHalfX = halfX;
    this.cfg.baseSearchHalfY = halfY;
  }

  /**
   * Tell the planner which arm placements to draw reach outlines for. `primaryYaw` is the yaw
   * the reachability sweep was computed at, used to recover the base-local boundary so each
   * arm's outline can be re-rotated to its own yaw. Cheap — no recompute, redraws instantly.
   */
  setArms(arms: ArmInstance[], primaryYaw: number) {
    this.arms = arms.map((a) => ({ ...a }));
    this.primaryYaw = primaryYaw;
    this.renderOutlines();
  }

  /**
   * Forward direction of the graspable (precision) fan, in the arm's LOCAL frame (base at origin,
   * yaw 0) — the angular BISECTOR of the occupied bins. Each occupied bin counts equally (NOT
   * radius-weighted), so a slightly-longer reach on one flank doesn't tilt "forward" by a few
   * degrees (which made a snapped arm sit at e.g. 187° instead of a clean 180°). Derived from the
   * live sweep so we never hardcode the model's base-orientation convention; falls back to the full
   * envelope, then 0.
   */
  /** Cached: the arm's reach direction at base-rotation 0, yaw 0 (a fixed model property — NOT
   *  obstacle/pose dependent). Computed once from a single FK; used to face a snapped arm inward. */
  private modelForward: number | null = null;
  localForwardAngle(): number { return this.modelForward ?? 0; }
  /** At base-rotation 0 the TCP's azimuth is the model's forward for ANY pitch/elbow (those change
   *  reach + height, not azimuth), so one FK at a mid-range pose gives it exactly + obstacle-free. */
  private computeModelForward(scratch: MujocoData) {
    const { mujoco, model, sweptJoints, tcpSiteId, baseBodyId } = this.cfg;
    this.setSweepBase(0, 0, 0); // base at origin, yaw 0 → reads in the local frame
    scratch.qpos[sweptJoints[0].qposAdr] = 0;
    for (const sj of sweptJoints.slice(1)) scratch.qpos[sj.qposAdr] = (sj.lo + sj.hi) / 2;
    mujoco.mj_forward(model, scratch);
    const dx = scratch.site_xpos[tcpSiteId * 3] - scratch.xpos[baseBodyId * 3];
    const dy = scratch.site_xpos[tcpSiteId * 3 + 1] - scratch.xpos[baseBodyId * 3 + 1];
    if (Math.hypot(dx, dy) > 1e-3) this.modelForward = Math.atan2(dy, dx);
  }

  // ── Forward reachability: sweep joints on a scratch MjData ──
  // The base-rotation joint (sweptJoints[0]) is swept FINELY (BASE_STEPS) since it dominates the
  // angular spread; the remaining joints at `resolution`. Each accepted TCP fills two things:
  //   • cells (reachCells / reachCellsMax) — used by base-placement + layout set-cover, and
  //   • the radial profiles (radMax / radPrec) — used to draw the clean fan outline.
  /** Set the obstacle cylinders considered by the reach sweep (posts + other arms). */
  setObstacles(obs: Array<{ x: number; y: number; r: number; zTop: number }>) { this.obstacles = obs; }

  /** Does the LIVE arm (in the given mjData pose) collide with a post? Used by the interactive jog
   *  clamp (Mode A) to stop a joint at the post like a joint limit. Tests the current obstacle set. */
  armCollidesLive(d: MujocoData): boolean { return this.armCollides(d, this.obstacles); }

  /** Arm subtree body ids (everything whose parent chain reaches the Base body) — the links whose
   *  swept geometry we collision-test. Memoised; falls back to [] if body_parentid isn't exposed. */
  private getArmBodies(): number[] {
    if (this.armBodies) return this.armBodies;
    const par = this.cfg.model.body_parentid as Int32Array | undefined;
    const ids: number[] = [];
    if (par) {
      const nb = this.cfg.model.nbody;
      for (let b = 1; b < nb; b++) {
        for (let p = b, g = 0; p > 0 && g < 64; p = par[p], g++) { if (p === this.cfg.baseBodyId) { ids.push(b); break; } }
      }
    }
    this.armBodies = ids;
    return ids;
  }

  /** Does the arm (in its current scratch pose) collide with any obstacle? Each link is the segment
   *  from a body to its parent (capsule radius LINK_R); obstacles are vertical cylinders. Cheap:
   *  a few sampled points per link vs each cylinder in XY, gated to the cylinder's height. */
  private armCollides(d: MujocoData, obstacles: Array<{ x: number; y: number; r: number; zTop: number }>): boolean {
    if (obstacles.length === 0) return false;
    const par = this.cfg.model.body_parentid as Int32Array | undefined;
    const ids = this.getArmBodies();
    const xp = d.xpos;
    // Fallback when the body tree isn't available: a single base→TCP capsule.
    const segs: Array<[number, number, number, number, number, number]> = [];
    if (par && ids.length) {
      // Each link = the segment from a body to its parent. SKIP the base body: its parent is the
      // world (id 0) at the ORIGIN, so its segment is a phantom link running from (0,0,0) to the
      // base — which spuriously collides with any post near the origin / the base-to-origin line
      // (it made a post at (0,0) block 100% of the workspace). The base is fixed and isn't a link.
      for (const b of ids) {
        if (b === this.cfg.baseBodyId) continue;
        const pb = par[b]; segs.push([xp[pb * 3], xp[pb * 3 + 1], xp[pb * 3 + 2], xp[b * 3], xp[b * 3 + 1], xp[b * 3 + 2]]);
      }
    } else {
      const bb = this.cfg.baseBodyId, t = this.cfg.tcpSiteId;
      segs.push([xp[bb * 3], xp[bb * 3 + 1], xp[bb * 3 + 2], d.site_xpos[t * 3], d.site_xpos[t * 3 + 1], d.site_xpos[t * 3 + 2]]);
    }
    for (const [ax, ay, az, bx, by, bz] of segs) {
      for (let s = 0; s <= SEG_SAMPLES; s++) {
        const f = s / SEG_SAMPLES, px = ax + (bx - ax) * f, py = ay + (by - ay) * f, pz = az + (bz - az) * f;
        for (const o of obstacles) {
          if (pz < -0.02 || pz > o.zTop + 0.02) continue;
          const dx = px - o.x, dy = py - o.y, rr = o.r + LINK_R;
          if (dx * dx + dy * dy < rr * rr) return true;
        }
      }
    }
    return false;
  }

  /** Move the (welded) arm Base body in the model to (x,y,yaw) so the next sweep happens AT that
   *  arm's mount — same edit relocateBase makes, but on the planner's model for the scratch sweep. */
  private setSweepBase(x: number, y: number, yaw: number) {
    const b = this.cfg.baseBodyId;
    const bp = this.cfg.model.body_pos as unknown as Float32Array;
    const bq = this.cfg.model.body_quat as unknown as Float32Array;
    bp[b * 3] = x; bp[b * 3 + 1] = y; // z left at its loaded value (arm on the floor)
    const h = yaw * 0.5;
    bq[b * 4] = Math.cos(h); bq[b * 4 + 1] = 0; bq[b * 4 + 2] = 0; bq[b * 4 + 3] = Math.sin(h);
  }

  /** Obstacles an arm must route around = the static posts + every OTHER arm's footprint. */
  private obstaclesFor(armId: string): Array<{ x: number; y: number; r: number; zTop: number }> {
    const obs = [...this.obstacles];
    for (const a of this.arms) if (a.id !== armId) obs.push({ x: a.x, y: a.y, r: 0.09, zTop: 0.35 });
    return obs;
  }

  /** One forward-kinematics sweep with the base WHERE IT CURRENTLY IS in the model + the given
   *  obstacles. Returns base-relative cells + radial profiles in the arm's local frame (yaw 0). */
  private sweepArm(scratch: MujocoData, resolution: number, yaw: number, obstacles: Array<{ x: number; y: number; r: number; zTop: number }>) {
    const { mujoco, model, sweptJoints, tcpSiteId } = this.cfg;
    mujoco.mj_forward(model, scratch);
    const baseX = scratch.xpos[this.cfg.baseBodyId * 3], baseY = scratch.xpos[this.cfg.baseBodyId * 3 + 1];
    const radMax = makeRadial(), radPrec = makeRadial();
    // cells = graspable configs per cell (collision-ignored → kinematic outline/heatmap);
    // free = the subset of those that are ALSO collision-free. A cell is truly blocked iff it is
    // graspable but has ZERO free configs (every grasp there routes a link through an obstacle).
    const cells = new Map<string, number>(), cellsMax = new Map<string, number>(), free = new Map<string, number>();
    const base = sweptJoints[0], armJoints = sweptJoints.slice(1);
    const nArm = Math.max(2, resolution), nBase = Math.max(nArm, BASE_STEPS);
    const armTotal = Math.pow(nArm, armJoints.length);
    const idx = new Array(armJoints.length).fill(0);
    const cos = Math.cos(-yaw), sin = Math.sin(-yaw); // un-rotate hits into the arm's local frame
    for (let bi = 0; bi < nBase; bi++) {
      scratch.qpos[base.qposAdr] = base.lo + (base.hi - base.lo) * (bi / (nBase - 1));
      for (let c = 0; c < armTotal; c++) {
        let rem = c;
        for (let j = 0; j < armJoints.length; j++) { idx[j] = rem % nArm; rem = (rem / nArm) | 0; }
        for (let j = 0; j < armJoints.length; j++) { const sj = armJoints[j]; scratch.qpos[sj.qposAdr] = sj.lo + (sj.hi - sj.lo) * (idx[j] / (nArm - 1)); }
        mujoco.mj_forward(model, scratch);
        const tz = scratch.site_xpos[tcpSiteId * 3 + 2];
        if (tz < 0 || tz > Z_BAND) continue;
        const tx = scratch.site_xpos[tcpSiteId * 3], ty = scratch.site_xpos[tcpSiteId * 3 + 1];
        const key = Math.round((tx - baseX) / CELL) + ',' + Math.round((ty - baseY) / CELL);
        const ox = tx - baseX, oy = ty - baseY;
        const lx = ox * cos - oy * sin, ly = ox * sin + oy * cos;
        const ang = Math.atan2(ly, lx), r = Math.hypot(lx, ly);
        // Outline + heatmap use the KINEMATIC reach (clean, obstacle-independent); obstacles are shown
        // ONLY by the red blocked overlay (so the fan keeps its smooth shape — no double-encoding).
        cellsMax.set(key, (cellsMax.get(key) ?? 0) + 1); accumRadial(radMax, ang, r);
        if (scratch.site_xmat[tcpSiteId * 9 + 7] < TOPDOWN_MIN) continue; // graspable from above only
        cells.set(key, (cells.get(key) ?? 0) + 1); accumRadial(radPrec, ang, r);
        if (!this.armCollides(scratch, obstacles)) free.set(key, (free.get(key) ?? 0) + 1); // a collision-free way to grasp here
      }
    }
    // A cell is BLOCKED only if it is graspable but NO config reaches it collision-free — i.e. the
    // obstacle removes EVERY grasp approach, not just some. (Flagging "any colliding config" over-
    // reports: cells the arm can still grasp by swinging the links around / reaching over the post.)
    const blocked = new Map<string, number>();
    for (const [key, n] of cells) if (!free.has(key)) blocked.set(key, n);
    return { radMax, radPrec, cells, cellsMax, blocked, baseX, baseY };
  }

  computeReachability(resolution = 9) {
    const { mujoco, model, sweptJoints, zeroQposAdr } = this.cfg;
    if (sweptJoints.length === 0) return;
    const scratch: MujocoData = new mujoco.MjData(model);
    const b = this.cfg.baseBodyId;
    const bp = model.body_pos as unknown as Float32Array, bq = model.body_quat as unknown as Float32Array;
    const savedP = [bp[b * 3], bp[b * 3 + 1], bp[b * 3 + 2]];
    const savedQ = [bq[b * 4], bq[b * 4 + 1], bq[b * 4 + 2], bq[b * 4 + 3]];
    try {
      for (const adr of zeroQposAdr) scratch.qpos[adr] = 0;
      if (this.modelForward == null) this.computeModelForward(scratch); // once: the model's forward axis
      this.armRadials.clear();
      this.armBlocked.clear();
      this.lastBlocked = null;
      // Sweep each arm at its OWN base + obstacle set (DRY: the same sweepArm per arm). A single
      // fallback sweep at the current base when no arm list is set yet.
      const arms = this.arms.length ? this.arms : [{ id: '__single', x: savedP[0], y: savedP[1], yaw: this.primaryYaw, primary: true } as ArmInstance];
      for (const arm of arms) {
        this.setSweepBase(arm.x, arm.y, arm.yaw);
        const r = this.sweepArm(scratch, resolution, arm.yaw, this.obstaclesFor(arm.id));
        this.armRadials.set(arm.id, { radMax: r.radMax, radPrec: r.radPrec });
        this.armBlocked.set(arm.id, r.blocked);
        if (arm.primary || arms.length === 1) { // mirror the primary for base-placement + localForwardAngle
          this.reachCells = r.cells; this.reachCellsMax = r.cellsMax;
          this.radMax = r.radMax; this.radPrec = r.radPrec; this.baseX = r.baseX; this.baseY = r.baseY;
          this.lastBlocked = { blocked: r.blocked.size, graspable: r.cells.size }; // blocked ⊆ cells
        }
      }
    } finally {
      // Restore the base to where it was (the primary's live pose) so the live sim is untouched.
      bp[b * 3] = savedP[0]; bp[b * 3 + 1] = savedP[1]; bp[b * 3 + 2] = savedP[2];
      bq[b * 4] = savedQ[0]; bq[b * 4 + 1] = savedQ[1]; bq[b * 4 + 2] = savedQ[2]; bq[b * 4 + 3] = savedQ[3];
      mujoco.mj_forward(model, scratch);
      scratch.delete();
    }
    this.renderReachTiles();
    this.renderBlockedTiles();
    this.renderOutlines();
    if (this.toggles.basePlacement) this.computeBasePlacement();
  }

  /** Red overlay: every arm's graspable-but-obstacle-blocked cells (no collision-free grasp), as
   *  full-cell quads so a contiguous block (the post + its shadow) reads as one solid red footprint
   *  while sparse blockage stays honestly sparse. Cell keys are world-aligned base-relative (the
   *  sweep ran at the arm's real x/y/yaw), so they place directly at arm.x/arm.y + di/dj·CELL. */
  private renderBlockedTiles() {
    const red = new THREE.Color(0xef4444);
    let i = 0;
    for (const arm of this.arms) {
      const cells = this.armBlocked.get(arm.id);
      if (!cells) continue;
      for (const key of cells.keys()) {
        if (i >= MAX_TILES) break;
        const [di, dj] = key.split(',').map(Number);
        this.dummy.position.set(arm.x + di * CELL, arm.y + dj * CELL, 0.0046);
        this.dummy.updateMatrix();
        this.blockedTiles.setMatrixAt(i, this.dummy.matrix);
        this.blockedTiles.setColorAt(i, red);
        i++;
      }
    }
    this.blockedTiles.count = i;
    this.blockedTiles.instanceMatrix.needsUpdate = true;
    if (this.blockedTiles.instanceColor) this.blockedTiles.instanceColor.needsUpdate = true;
    this.blockedTiles.visible = this.toggles.blocked;
  }

  // ── Inverse: for each candidate mount cell, how many task points become reachable? ──
  computeBasePlacement() {
    const tasks = this.taskWorldPoints();
    const halfX = this.cfg.baseSearchHalfX ?? 0.4;
    const halfY = this.cfg.baseSearchHalfY ?? 0.4;
    let best = { x: this.baseX, y: this.baseY, covered: -1 };
    const scored: Array<{ x: number; y: number; cov: number }> = [];

    for (let cx = -halfX; cx <= halfX + 1e-6; cx += CELL) {
      for (let cy = -halfY; cy <= halfY + 1e-6; cy += CELL) {
        let cov = 0;
        for (const t of tasks) {
          const di = Math.round((t.x - cx) / CELL);
          const dj = Math.round((t.y - cy) / CELL);
          if ((this.reachCells.get(di + ',' + dj) ?? 0) > 0) cov++;
        }
        scored.push({ x: cx, y: cy, cov });
        if (cov > best.covered) best = { x: cx, y: cy, covered: cov };
      }
    }

    this.renderBaseTiles(scored, tasks.length);
    this.bestMarker.position.set(best.x, best.y, 0.005);
    this.bestMarker.visible = this.toggles.basePlacement && best.covered > 0;
    this.lastBaseResult = { x: best.x, y: best.y, covered: Math.max(0, best.covered), total: tasks.length };
  }

  /**
   * Suggest placements for N arms that MAXIMISE top-down task coverage (greedy set-cover over
   * mount cell × yaw): repeatedly place an arm where it newly covers the most still-uncovered tasks.
   * Uses the PRECISION reach set (graspable), translated+rotated under each candidate. Returns the
   * N poses + how many of the total tasks the set covers.
   */
  suggestArmLayout(n: number): { poses: Array<{ x: number; y: number; yaw: number }>; covered: number; total: number } {
    const tasks = this.taskWorldPoints();
    const halfX = this.cfg.baseSearchHalfX ?? 0.4;
    const halfY = this.cfg.baseSearchHalfY ?? 0.4;
    const yaws = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4, Math.PI, -Math.PI / 4, -Math.PI / 2, -(3 * Math.PI) / 4];
    // reachCells were computed with the base at `primaryYaw`, so to test a candidate at yaw φ we
    // rotate the task by (primaryYaw − φ) into the cell frame (= −φ only when primaryYaw is 0).
    const reaches = (t: { x: number; y: number }, cx: number, cy: number, angle: number): boolean => {
      const c = Math.cos(angle), s = Math.sin(angle);
      const dx = t.x - cx, dy = t.y - cy;
      const di = Math.round((dx * c - dy * s) / CELL), dj = Math.round((dx * s + dy * c) / CELL);
      return (this.reachCells.get(di + ',' + dj) ?? 0) > 0;
    };

    const remaining = new Set(tasks.map((_, i) => i));
    const poses: Array<{ x: number; y: number; yaw: number }> = [];
    for (let k = 0; k < Math.max(1, n) && remaining.size > 0; k++) {
      let bestCov = 0, bestPose: { x: number; y: number; yaw: number } | null = null, bestSet: number[] = [];
      for (let cx = -halfX; cx <= halfX + 1e-6; cx += CELL) {
        for (let cy = -halfY; cy <= halfY + 1e-6; cy += CELL) {
          for (const yaw of yaws) {
            const angle = this.primaryYaw - yaw;
            const set: number[] = [];
            for (const idx of remaining) if (reaches(tasks[idx], cx, cy, angle)) set.push(idx);
            if (set.length > bestCov) { bestCov = set.length; bestPose = { x: cx, y: cy, yaw }; bestSet = set; }
          }
        }
      }
      if (!bestPose || bestCov === 0) break;
      poses.push(bestPose);
      bestSet.forEach((i) => remaining.delete(i));
    }
    // Pad with the primary spot if fewer placements than arms (e.g. everything already covered).
    while (poses.length < Math.max(1, n)) poses.push({ x: this.baseX, y: this.baseY, yaw: 0 });
    return { poses, covered: tasks.length - remaining.size, total: tasks.length };
  }

  dispose() {
    this.control.detach();
    this.control.dispose();
    this.scene.remove(this.group, this.gizmoHelper);
    // Free every geometry + material under the group (this planner is re-created on each
    // base/workcell reload, so leaking here accumulates GPU memory per drag — QA-H1).
    this.group.traverse((o) => {
      const obj = o as THREE.Mesh & THREE.Line;
      if (obj.geometry) obj.geometry.dispose();
      const mat = obj.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else if (mat) mat.dispose();
    });
    // InstancedMesh.dispose() additionally frees the instanceMatrix/instanceColor buffers.
    this.reachTiles.dispose();
    this.baseTiles.dispose();
    this.blockedTiles.dispose();
  }

  // ───────────────────────── internals ─────────────────────────

  private makeTiles(fill = 0.92): THREE.InstancedMesh {
    const geo = new THREE.PlaneGeometry(CELL * fill, CELL * fill);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.InstancedMesh(geo, mat, MAX_TILES);
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /** blue (low) → green → red (high) */
  private heat(t: number): THREE.Color {
    return this.color.setHSL((1 - Math.max(0, Math.min(1, t))) * 0.66, 0.9, 0.5);
  }

  private renderReachTiles() {
    let max = 1;
    for (const v of this.reachCells.values()) max = Math.max(max, v);
    let i = 0;
    for (const [key, v] of this.reachCells) {
      if (i >= MAX_TILES) break;
      const [di, dj] = key.split(',').map(Number);
      this.dummy.position.set(this.baseX + di * CELL, this.baseY + dj * CELL, 0.004);
      this.dummy.updateMatrix();
      this.reachTiles.setMatrixAt(i, this.dummy.matrix);
      this.reachTiles.setColorAt(i, this.heat(v / max));
      i++;
    }
    this.reachTiles.count = i;
    this.reachTiles.instanceMatrix.needsUpdate = true;
    if (this.reachTiles.instanceColor) this.reachTiles.instanceColor.needsUpdate = true;
  }

  /**
   * Build the reach outline from a radial r(θ) profile, in the arm's LOCAL frame (base at origin,
   * yaw 0). For each occupied angular bin we know [rMin, rMax]; we trace the outer boundary
   * (rMax) forward through the bins, then the inner boundary (rMin) back — opening the fan at the
   * largest angular gap (the part the base can't swing to). Because r is single-valued per angle,
   * the resulting polygon is ALWAYS simple (no self-crossing, no islands, no holes-as-fragments) —
   * a clean annular fan by construction. If the reach wraps a full 360° (folds all the way round),
   * emit the outer + inner boundaries as two separate rings instead.
   */
  private radialFan(rad: Radial): Array<Array<[number, number]>> {
    const N = ANG_BINS;
    const ang = (b: number) => -Math.PI + (b + 0.5) * (2 * Math.PI / N);
    const occ: number[] = [];
    for (let b = 0; b < N; b++) if (rad.rMax[b] >= 0) occ.push(b);
    if (occ.length < 3) return [];

    // Largest cyclic gap between occupied bins → the fan opening.
    let gapAt = 0, gapLen = -1;
    for (let i = 0; i < occ.length; i++) {
      const d = (occ[(i + 1) % occ.length] - occ[i] + N) % N;
      if (d > gapLen) { gapLen = d; gapAt = i; }
    }
    // Order occupied bins by angle starting just after the gap.
    const ordered: number[] = [];
    for (let k = 1; k <= occ.length; k++) ordered.push(occ[(gapAt + k) % occ.length]);

    const pt = (b: number, r: number): [number, number] => [r * Math.cos(ang(b)), r * Math.sin(ang(b))];

    if (gapLen <= 2) {
      // Full ring: outer + (optional) inner boundary as separate closed loops.
      const outer = ordered.map((b) => pt(b, rad.rMax[b]));
      const hasHole = ordered.some((b) => rad.rMin[b] > CELL * 1.5);
      const loops = [chaikin(outer, 1)];
      if (hasHole) loops.push(chaikin(ordered.map((b) => pt(b, Math.max(0, rad.rMin[b]))), 1));
      return loops;
    }
    // An obstacle can carve the fan into SEVERAL disconnected arcs. Split `ordered` into contiguous
    // runs (bridging tiny ≤2-bin gaps) and emit one sector per run, so a fully-blocked wedge reads as
    // a clean gap — not a straight chord/spike across it (the old single-sector bug).
    const BRIDGE = 2;
    const runs: number[][] = [];
    let cur: number[] = [ordered[0]];
    for (let i = 1; i < ordered.length; i++) {
      if ((ordered[i] - ordered[i - 1] + N) % N <= BRIDGE) cur.push(ordered[i]);
      else { runs.push(cur); cur = [ordered[i]]; }
    }
    runs.push(cur);
    const loops: Array<Array<[number, number]>> = [];
    for (const run of runs) {
      if (run.length < 2) continue;
      const outer = run.map((b) => pt(b, rad.rMax[b]));
      const inner: Array<[number, number]> = [];
      for (let i = run.length - 1; i >= 0; i--) inner.push(pt(run[i], Math.max(0, rad.rMin[run[i]])));
      loops.push(chaikin(outer.concat(inner), 1));
    }
    return loops;
  }

  /**
   * Draw TWO reach contours per arm (transformed to its x,y,yaw):
   *  • MAX envelope — the full physically-reachable footprint (~340°, faint grey).
   *  • PRECISION    — where the gripper can point straight down to grasp (bright, arm-coloured).
   * Mirrors the Hexagon-Mount mental model: "reaches almost everywhere, grasps in this front fan".
   */
  private renderOutlines() {
    for (const child of [...this.outlineGroup.children]) {
      const seg = child as LineSegments2;
      seg.geometry.dispose();
      (seg.material as THREE.Material).dispose();
    }
    this.outlineGroup.clear();
    if (this.arms.length === 0) return;

    const addContour = (loops: Array<Array<[number, number]>>, arm: ArmInstance, color: number, linewidth: number, opacity: number, z: number) => {
      if (loops.length === 0) return;
      const c = Math.cos(arm.yaw), s = Math.sin(arm.yaw);
      const positions: number[] = [];
      for (const loop of loops) {
        // Closed smoothed polyline → consecutive vertex pairs (wrapping last→first).
        for (let i = 0; i < loop.length; i++) {
          const [x1, y1] = loop[i];
          const [x2, y2] = loop[(i + 1) % loop.length];
          positions.push(arm.x + x1 * c - y1 * s, arm.y + x1 * s + y1 * c, z);
          positions.push(arm.x + x2 * c - y2 * s, arm.y + x2 * s + y2 * c, z);
        }
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(positions);
      const mat = new LineMaterial({ color, linewidth, transparent: true, opacity });
      mat.resolution.set(window.innerWidth, window.innerHeight);
      const seg = new LineSegments2(geo, mat);
      seg.frustumCulled = false;
      this.outlineGroup.add(seg);
    };

    this.arms.forEach((arm, i) => {
      // Each arm draws from its OWN obstacle-aware sweep (fallback to the primary's if missing).
      const rr = this.armRadials.get(arm.id);
      const maxLocal = this.radialFan(rr?.radMax ?? this.radMax);
      const precLocal = this.radialFan(rr?.radPrec ?? this.radPrec);
      addContour(maxLocal, arm, 0x9d8cc9, 1.5, 0.6, 0.006);  // max reach envelope (violet = "reach")
      addContour(precLocal, arm, WorkspacePlanner.ARM_PALETTE[i % WorkspacePlanner.ARM_PALETTE.length], 2.5, 0.95, 0.009); // precision
    });
    this.outlineGroup.visible = this.toggles.outline;
  }

  private renderBaseTiles(scored: Array<{ x: number; y: number; cov: number }>, total: number) {
    let i = 0;
    for (const s of scored) {
      if (i >= MAX_TILES) break;
      if (s.cov <= 0) continue;
      this.dummy.position.set(s.x, s.y, 0.0045);
      this.dummy.updateMatrix();
      this.baseTiles.setMatrixAt(i, this.dummy.matrix);
      this.baseTiles.setColorAt(i, this.heat(total > 0 ? s.cov / total : 0));
      i++;
    }
    this.baseTiles.count = i;
    this.baseTiles.instanceMatrix.needsUpdate = true;
    if (this.baseTiles.instanceColor) this.baseTiles.instanceColor.needsUpdate = true;
  }

  private buildTaskMarkers() {
    this.taskMarkers.clear();
    for (const t of this.taskWorldPoints()) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.006, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.85 }),
      );
      m.position.set(t.x, t.y, t.z + 0.025);
      this.taskMarkers.add(m);
    }
  }

  private readBaseWorld(data?: MujocoData) {
    // Reuse the caller's scratch when given (sweep), else make a throwaway one.
    const d = data ?? new this.cfg.mujoco.MjData(this.cfg.model);
    this.cfg.mujoco.mj_forward(this.cfg.model, d);
    this.baseX = d.xpos[this.cfg.baseBodyId * 3];
    this.baseY = d.xpos[this.cfg.baseBodyId * 3 + 1];
    if (!data) d.delete();
  }

  taskWorldPoints(): Array<{ x: number; y: number; z: number }> {
    // Read positions from a fresh forward pass so they reflect any base relocation.
    const { mujoco, model } = this.cfg;
    const scratch = new mujoco.MjData(model);
    const pts: Array<{ x: number; y: number; z: number }> = [];
    try {
      mujoco.mj_forward(model, scratch);
      for (const id of this.cfg.taskBodyIds) {
        pts.push({ x: scratch.xpos[id * 3], y: scratch.xpos[id * 3 + 1], z: scratch.xpos[id * 3 + 2] });
      }
    } finally {
      scratch.delete();
    }
    return pts;
  }

  private applyToggles() {
    this.outlineGroup.visible = this.toggles.outline;
    this.reachTiles.visible = this.toggles.reach;
    this.blockedTiles.visible = this.toggles.blocked;
    this.baseTiles.visible = this.toggles.basePlacement;
    this.bestMarker.visible = this.toggles.basePlacement && (this.lastBaseResult?.covered ?? 0) > 0;
    this.taskMarkers.visible = this.toggles.tasks;
    this.baseDisc.visible = this.toggles.baseDrag;
    this.gizmoHelper.visible = this.toggles.baseDrag;
    this.control.enabled = this.toggles.baseDrag;
  }
}

// ── Radial reach profile: per-angle min/max reachable radius → clean fan ──

interface Radial { rMin: Float64Array; rMax: Float64Array; }

function makeRadial(): Radial {
  const rMin = new Float64Array(ANG_BINS).fill(Infinity);
  const rMax = new Float64Array(ANG_BINS).fill(-Infinity);
  return { rMin, rMax };
}
function resetRadial(rad: Radial) {
  rad.rMin.fill(Infinity);
  rad.rMax.fill(-Infinity);
}
/** Record a reach radius at a local angle into its bin (tracks the min & max radius per bin). */
function accumRadial(rad: Radial, theta: number, r: number) {
  let b = Math.floor((theta + Math.PI) / (2 * Math.PI) * ANG_BINS);
  if (b < 0) b = 0; else if (b >= ANG_BINS) b = ANG_BINS - 1;
  if (r < rad.rMin[b]) rad.rMin[b] = r;
  if (r > rad.rMax[b]) rad.rMax[b] = r;
}

/** Chaikin corner-cutting on a CLOSED polygon: each pass quarters every corner → smooth curve. */
function chaikin(loop: Array<[number, number]>, iters: number): Array<[number, number]> {
  let pts = loop;
  for (let it = 0; it < iters; it++) {
    const out: Array<[number, number]> = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    pts = out;
  }
  return pts;
}
