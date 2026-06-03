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
  private static readonly ARM_PALETTE = [0x10b981, 0x6366f1, 0xf59e0b, 0xef4444, 0x06b6d4, 0xec4899];

  // Base-relative reachable cells: "di,dj" -> hit count. Reusable for inverse placement.
  private reachCells = new Map<string, number>();
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

  // ── Forward reachability: sweep joints on a scratch MjData, bin TCP hits into cells ──
  computeReachability(resolution = 9) {
    const { mujoco, model, sweptJoints, zeroQposAdr, tcpSiteId } = this.cfg;
    const scratch: MujocoData = new mujoco.MjData(model);
    try {
      for (const adr of zeroQposAdr) scratch.qpos[adr] = 0;
      this.readBaseWorld(scratch);

      this.reachCells.clear();
      const n = Math.max(2, resolution);
      const idx = new Array(sweptJoints.length).fill(0);
      const total = Math.pow(n, sweptJoints.length);

      for (let c = 0; c < total; c++) {
        // decode c -> per-joint index
        let rem = c;
        for (let j = 0; j < sweptJoints.length; j++) { idx[j] = rem % n; rem = (rem / n) | 0; }
        for (let j = 0; j < sweptJoints.length; j++) {
          const sj = sweptJoints[j];
          scratch.qpos[sj.qposAdr] = sj.lo + (sj.hi - sj.lo) * (idx[j] / (n - 1));
        }
        mujoco.mj_forward(model, scratch);
        const tz = scratch.site_xpos[tcpSiteId * 3 + 2];
        if (tz < 0 || tz > Z_BAND) continue; // only count reaching down toward the worktop
        // Top-down filter: count only configs where the gripper approach points roughly DOWN
        // (graspable from above). Arm folding otherwise lets the TCP reach ~360° of azimuth —
        // physically real, but not "useful top-down reach", which is what this footprint means.
        // approach = -localY of the tcp site (fingers extend along Fixed_Jaw -y); its world z
        // component is -site_xmat[7]; "points down" ⇒ that is negative ⇒ site_xmat[7] > cos(angle).
        if (scratch.site_xmat[tcpSiteId * 9 + 7] < TOPDOWN_MIN) continue;
        const tx = scratch.site_xpos[tcpSiteId * 3];
        const ty = scratch.site_xpos[tcpSiteId * 3 + 1];
        const di = Math.round((tx - this.baseX) / CELL);
        const dj = Math.round((ty - this.baseY) / CELL);
        const key = di + ',' + dj;
        this.reachCells.set(key, (this.reachCells.get(key) ?? 0) + 1);
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
   * The boundary edges of the reachable cell region, in the arm's LOCAL frame (un-rotated by
   * the sweep's yaw). Each entry is a segment [x1,y1,x2,y2] = a cell edge that borders empty
   * space. This is the TRUE silhouette of the reachable footprint — so it honestly shows the
   * base-rotation fan (the SO-101 can't swing a full 360°, only ~±110°) and the inner dead zone,
   * instead of a misleading ring. (Marching-squares-style edge extraction.)
   */
  private computeLocalSilhouette(): Array<[number, number, number, number]> {
    if (this.reachCells.size === 0) return [];
    // Dilate the sampled cells by 1 (8-connected) to close FK-sampling gaps, so the silhouette
    // traces one clean contour instead of a maze of tiny single-sample holes.
    const cells = new Set<string>();
    for (const key of this.reachCells.keys()) {
      const c = key.indexOf(',');
      const di = +key.slice(0, c), dj = +key.slice(c + 1);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) cells.add((di + a) + ',' + (dj + b));
    }
    const occ = (di: number, dj: number) => cells.has(di + ',' + dj);

    // Grid bounds + a 1-cell empty margin ring.
    let minI = Infinity, maxI = -Infinity, minJ = Infinity, maxJ = -Infinity;
    for (const key of cells.keys()) {
      const c = key.indexOf(',');
      const di = +key.slice(0, c), dj = +key.slice(c + 1);
      if (di < minI) minI = di; if (di > maxI) maxI = di;
      if (dj < minJ) minJ = dj; if (dj > maxJ) maxJ = dj;
    }
    minI--; maxI++; minJ--; maxJ++;

    // Flood-fill the EXTERIOR empty cells from the border, so interior holes (sparse-sampling
    // gaps inside the reachable region) are NOT outlined — only the true outer contour is.
    const outside = new Set<string>();
    const stack: Array<[number, number]> = [];
    const visit = (di: number, dj: number) => {
      if (di < minI || di > maxI || dj < minJ || dj > maxJ) return;
      const k = di + ',' + dj;
      if (occ(di, dj) || outside.has(k)) return;
      outside.add(k); stack.push([di, dj]);
    };
    for (let di = minI; di <= maxI; di++) { visit(di, minJ); visit(di, maxJ); }
    for (let dj = minJ; dj <= maxJ; dj++) { visit(minI, dj); visit(maxI, dj); }
    while (stack.length) {
      const [di, dj] = stack.pop()!;
      visit(di + 1, dj); visit(di - 1, dj); visit(di, dj + 1); visit(di, dj - 1);
    }
    const isExterior = (di: number, dj: number) =>
      di < minI || di > maxI || dj < minJ || dj > maxJ || outside.has(di + ',' + dj);

    // Emit the cell edge wherever an occupied cell borders the exterior → outer silhouette only.
    const cos = Math.cos(-this.primaryYaw), sin = Math.sin(-this.primaryYaw);
    const toLocal = (x: number, y: number): [number, number] => [x * cos - y * sin, x * sin + y * cos];
    const H = CELL / 2;
    const segs: Array<[number, number, number, number]> = [];
    for (const key of cells.keys()) {
      const comma = key.indexOf(',');
      const di = +key.slice(0, comma), dj = +key.slice(comma + 1);
      const cx = di * CELL, cy = dj * CELL;
      if (isExterior(di + 1, dj)) { const [a, b] = toLocal(cx + H, cy - H); const [c, d] = toLocal(cx + H, cy + H); segs.push([a, b, c, d]); }
      if (isExterior(di - 1, dj)) { const [a, b] = toLocal(cx - H, cy - H); const [c, d] = toLocal(cx - H, cy + H); segs.push([a, b, c, d]); }
      if (isExterior(di, dj + 1)) { const [a, b] = toLocal(cx - H, cy + H); const [c, d] = toLocal(cx + H, cy + H); segs.push([a, b, c, d]); }
      if (isExterior(di, dj - 1)) { const [a, b] = toLocal(cx - H, cy - H); const [c, d] = toLocal(cx + H, cy - H); segs.push([a, b, c, d]); }
    }
    return segs;
  }

  /** Draw the reach silhouette per arm (transformed to its x,y,yaw), color-coded. */
  private renderOutlines() {
    for (const child of [...this.outlineGroup.children]) {
      const seg = child as LineSegments2;
      seg.geometry.dispose();
      (seg.material as THREE.Material).dispose();
    }
    this.outlineGroup.clear();
    if (this.reachCells.size === 0 || this.arms.length === 0) return;

    const local = this.computeLocalSilhouette();
    if (local.length === 0) return;

    this.arms.forEach((arm, i) => {
      const c = Math.cos(arm.yaw), s = Math.sin(arm.yaw);
      const positions: number[] = [];
      for (const [x1, y1, x2, y2] of local) {
        positions.push(arm.x + x1 * c - y1 * s, arm.y + x1 * s + y1 * c, 0.008);
        positions.push(arm.x + x2 * c - y2 * s, arm.y + x2 * s + y2 * c, 0.008);
      }
      const geo = new LineSegmentsGeometry();
      geo.setPositions(positions);
      const mat = new LineMaterial({
        color: WorkspacePlanner.ARM_PALETTE[i % WorkspacePlanner.ARM_PALETTE.length],
        linewidth: 2.5, transparent: true, opacity: 0.95,
      });
      mat.resolution.set(window.innerWidth, window.innerHeight);
      const seg = new LineSegments2(geo, mat);
      seg.frustumCulled = false;
      this.outlineGroup.add(seg);
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

  private taskWorldPoints(): Array<{ x: number; y: number; z: number }> {
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
