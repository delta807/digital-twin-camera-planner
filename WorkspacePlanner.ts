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
  private taskMarkers = new THREE.Group();
  private bestMarker: THREE.Mesh;
  private baseDisc: THREE.Mesh;
  private control: TransformControls;

  private toggles: PlannerToggles = { outline: true, reach: false, basePlacement: false, tasks: false, baseDrag: false };

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
  private baseX = 0;
  private baseY = 0;
  /** Result of the last base-placement pass, for the UI readout. */
  lastBaseResult: { x: number; y: number; covered: number; total: number } | null = null;

  private readonly dummy = new THREE.Object3D();
  private readonly color = new THREE.Color();

  constructor(private scene: THREE.Scene, cfg: PlannerConfig) {
    this.cfg = cfg;
    this.reachTiles = this.makeTiles();
    this.baseTiles = this.makeTiles();
    this.group.add(this.reachTiles, this.baseTiles, this.taskMarkers, this.outlineGroup);

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
   * Reach-weighted mean direction of the graspable (precision) fan, in the arm's LOCAL frame
   * (base at origin, yaw 0). This is "which way the arm actually reaches" derived from the live
   * MuJoCo sweep — so callers can face a snapped arm INTO the table without hardcoding the
   * model's base-orientation convention. Falls back to the full envelope, then 0.
   */
  localForwardAngle(): number {
    const meanDir = (rad: Radial): [number, number] => {
      let sx = 0, sy = 0;
      for (let b = 0; b < ANG_BINS; b++) {
        const r = rad.rMax[b];
        if (!isFinite(r) || r <= 0) continue;
        const theta = -Math.PI + ((b + 0.5) / ANG_BINS) * 2 * Math.PI;
        sx += r * Math.cos(theta); sy += r * Math.sin(theta);
      }
      return [sx, sy];
    };
    let [sx, sy] = meanDir(this.radPrec);
    if (sx === 0 && sy === 0) [sx, sy] = meanDir(this.radMax);
    return sx === 0 && sy === 0 ? 0 : Math.atan2(sy, sx);
  }

  // ── Forward reachability: sweep joints on a scratch MjData ──
  // The base-rotation joint (sweptJoints[0]) is swept FINELY (BASE_STEPS) since it dominates the
  // angular spread; the remaining joints at `resolution`. Each accepted TCP fills two things:
  //   • cells (reachCells / reachCellsMax) — used by base-placement + layout set-cover, and
  //   • the radial profiles (radMax / radPrec) — used to draw the clean fan outline.
  computeReachability(resolution = 9) {
    const { mujoco, model, sweptJoints, zeroQposAdr, tcpSiteId } = this.cfg;
    if (sweptJoints.length === 0) return;
    const scratch: MujocoData = new mujoco.MjData(model);
    try {
      for (const adr of zeroQposAdr) scratch.qpos[adr] = 0;
      this.readBaseWorld(scratch);

      this.reachCells.clear();
      this.reachCellsMax.clear();
      resetRadial(this.radMax);
      resetRadial(this.radPrec);

      const base = sweptJoints[0];
      const armJoints = sweptJoints.slice(1);
      const nArm = Math.max(2, resolution);
      const nBase = Math.max(nArm, BASE_STEPS);
      const armTotal = Math.pow(nArm, armJoints.length);
      const idx = new Array(armJoints.length).fill(0);
      // Un-rotate world hits by the sweep yaw to get the arm's LOCAL frame (so each arm's outline
      // can be re-rotated to its own yaw later).
      const cos = Math.cos(-this.primaryYaw), sin = Math.sin(-this.primaryYaw);

      for (let bi = 0; bi < nBase; bi++) {
        scratch.qpos[base.qposAdr] = base.lo + (base.hi - base.lo) * (bi / (nBase - 1));
        for (let c = 0; c < armTotal; c++) {
          let rem = c;
          for (let j = 0; j < armJoints.length; j++) { idx[j] = rem % nArm; rem = (rem / nArm) | 0; }
          for (let j = 0; j < armJoints.length; j++) {
            const sj = armJoints[j];
            scratch.qpos[sj.qposAdr] = sj.lo + (sj.hi - sj.lo) * (idx[j] / (nArm - 1));
          }
          mujoco.mj_forward(model, scratch);
          const tz = scratch.site_xpos[tcpSiteId * 3 + 2];
          if (tz < 0 || tz > Z_BAND) continue; // only count reaching down toward the worktop
          const tx = scratch.site_xpos[tcpSiteId * 3];
          const ty = scratch.site_xpos[tcpSiteId * 3 + 1];
          const di = Math.round((tx - this.baseX) / CELL);
          const dj = Math.round((ty - this.baseY) / CELL);
          const key = di + ',' + dj;
          // MAX envelope: every config that reaches worktop height (physically reachable).
          this.reachCellsMax.set(key, (this.reachCellsMax.get(key) ?? 0) + 1);
          // local polar (base at origin, yaw 0) → radial bin.
          const ox = tx - this.baseX, oy = ty - this.baseY;
          const lx = ox * cos - oy * sin, ly = ox * sin + oy * cos;
          accumRadial(this.radMax, Math.atan2(ly, lx), Math.hypot(lx, ly));
          // PRECISION: also require the gripper approach to point roughly DOWN (graspable from
          // above). approach = -localY of the tcp site; world-z component is -site_xmat[7], so
          // "points down" ⇒ site_xmat[7] > cos(angle).
          if (scratch.site_xmat[tcpSiteId * 9 + 7] < TOPDOWN_MIN) continue;
          this.reachCells.set(key, (this.reachCells.get(key) ?? 0) + 1);
          accumRadial(this.radPrec, Math.atan2(ly, lx), Math.hypot(lx, ly));
        }
      }
    } finally {
      scratch.delete();
    }
    this.renderReachTiles();
    this.renderOutlines();
    if (this.toggles.basePlacement) this.computeBasePlacement();
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
  }

  // ───────────────────────── internals ─────────────────────────

  private makeTiles(): THREE.InstancedMesh {
    const geo = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92);
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
    const hasHole = ordered.some((b) => rad.rMin[b] > CELL * 1.5);
    const outer = ordered.map((b) => pt(b, rad.rMax[b]));

    if (gapLen <= 2) {
      // Full ring: outer + (optional) inner boundary as separate closed loops.
      const loops = [chaikin(outer, 1)];
      if (hasHole) loops.push(chaikin(ordered.map((b) => pt(b, Math.max(0, rad.rMin[b]))), 1));
      return loops;
    }
    // Sector: one closed loop = outer arc forward + inner arc back.
    const inner: Array<[number, number]> = [];
    for (let i = ordered.length - 1; i >= 0; i--) inner.push(pt(ordered[i], Math.max(0, rad.rMin[ordered[i]])));
    return [chaikin(outer.concat(inner), 1)];
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

    const maxLocal = this.radialFan(this.radMax);
    const precLocal = this.radialFan(this.radPrec);

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
