/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LengthUnit, formatLen } from './types';

/** Screen-space snap radius (CSS px): cursor within this of a vertex/edge snaps to it. */
const SNAP_PX = 12;
type SnapType = 'vertex' | 'edge' | 'surface';
const SNAP_COLOR: Record<SnapType, number> = { vertex: 0x22c55e, edge: 0x3b82f6, surface: 0xf59e0b };

export interface Measurement {
  id: string;
  distance: number;
  dx: number; dy: number; dz: number;
  label: string;
}

interface Entry {
  data: Measurement;
  a: THREE.Vector3;
  b: THREE.Vector3;
  objects: THREE.Object3D[]; // line + 2 markers + label, for disposal
  labelEl: HTMLDivElement;
}

/**
 * MeasureTool — CAD-style point/object distance measurement.
 *
 * Click two things → a dimension line + distance label appear in the scene, and a persistent
 * entry (distance + ΔX/ΔY/ΔZ) is reported to React. Snapping mirrors OrcaSlicer/FreeCAD: as the
 * cursor moves it snaps to the nearest mesh VERTEX, then EDGE, then falls back to the exact
 * SURFACE point — chosen in screen space (within SNAP_PX), so the snap matches what the eye
 * sees regardless of depth. A colour-coded hover dot previews the live snap (green=vertex,
 * blue=edge, amber=free surface). Shift forces a free surface point (no snap). A drag is an
 * orbit, not a pick. Lines/markers draw over geometry; labels are crisp DOM via CSS2DRenderer.
 */
export class MeasureTool {
  active = false;
  readonly group = new THREE.Group();
  onChange: ((list: Measurement[]) => void) | null = null;

  private unit: LengthUnit = 'm';
  private prevCursor = '';
  private pending: { point: THREE.Vector3; marker: THREE.Mesh } | null = null;
  private entries: Entry[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly downPos = new THREE.Vector2();
  private idCounter = 0;
  private readonly hoverMarker: THREE.Mesh;     // live snap preview dot
  private hoverSnap: { point: THREE.Vector3; type: SnapType } | null = null;

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private dom: HTMLElement,
    private getTargets: () => THREE.Object3D[],
  ) {
    this.group.name = 'Measurements';
    this.scene.add(this.group);
    this.hoverMarker = this.makeMarker(new THREE.Vector3(), SNAP_COLOR.surface);
    this.hoverMarker.visible = false;
    this.group.add(this.hoverMarker);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('pointerup', this.onPointerUp);
    this.dom.addEventListener('pointermove', this.onPointerMove);
    this.dom.addEventListener('pointerleave', this.onPointerLeave);
  }

  setActive(v: boolean) {
    this.active = v;
    // Save/restore the canvas cursor so toggling measure off doesn't clobber another
    // tool's cursor (e.g. a TransformControls grab state) on the shared canvas.
    if (v) { this.prevCursor = this.dom.style.cursor; this.dom.style.cursor = 'crosshair'; }
    else { this.dom.style.cursor = this.prevCursor; this.clearPending(); this.hoverMarker.visible = false; this.hoverSnap = null; }
  }

  setUnit(u: LengthUnit) {
    if (u === this.unit) return;
    this.unit = u;
    for (const e of this.entries) e.labelEl.textContent = formatLen(e.data.distance, u);
    this.emit();
  }

  clear() {
    for (const e of [...this.entries]) this.disposeEntry(e);
    this.entries = [];
    this.clearPending();
    this.emit();
  }

  remove(id: string) {
    const e = this.entries.find((x) => x.data.id === id);
    if (e) { this.disposeEntry(e); this.entries = this.entries.filter((x) => x !== e); this.emit(); }
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    this.dom.removeEventListener('pointerup', this.onPointerUp);
    this.dom.removeEventListener('pointermove', this.onPointerMove);
    this.dom.removeEventListener('pointerleave', this.onPointerLeave);
    this.clear();
    this.disposeObject(this.hoverMarker);
    this.scene.remove(this.group);
  }

  // ───────────────────────── picking ─────────────────────────

  private onPointerDown = (e: PointerEvent) => { this.downPos.set(e.clientX, e.clientY); };

  private onPointerLeave = () => {
    if (this.hoverMarker.visible) this.hoverMarker.visible = false;
    this.hoverSnap = null;
  };

  /** Live snap preview: update the hover dot as the cursor moves over geometry. */
  private onPointerMove = (e: PointerEvent) => {
    if (!this.active) return;
    const snap = this.computeSnap(e);
    this.hoverSnap = snap;
    if (!snap) { this.hoverMarker.visible = false; return; }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.copy(snap.point);
    (this.hoverMarker.material as THREE.MeshBasicMaterial).color.setHex(SNAP_COLOR[snap.type]);
    this.hoverMarker.scale.setScalar(snap.type === 'vertex' ? 1.5 : 1);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return;
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) return; // orbit drag, not a pick
    // Prefer the live hover snap (kept fresh by pointermove); recompute as a fallback.
    const snap = this.hoverSnap ?? this.computeSnap(e);
    if (!snap) return;
    const point = snap.point.clone();
    if (!this.pending) {
      const marker = this.makeMarker(point, 0xf59e0b);
      this.group.add(marker);
      this.pending = { point, marker };
    } else {
      this.addMeasurement(this.pending.point, point);
      this.clearPending();
    }
  };

  /**
   * Snap engine: raycast the cursor, then within the hit triangle pick the nearest VERTEX
   * (priority) or EDGE in SCREEN space (≤ SNAP_PX), else the exact SURFACE point. Working off
   * the intersected face's three vertices gives local vertex+edge snapping with no whole-mesh
   * edge precomputation. Shift bypasses snapping (free surface point).
   */
  private computeSnap(e: PointerEvent): { point: THREE.Vector3; type: SnapType } | null {
    const rect = this.dom.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    this.raycaster.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects(this.getTargets(), true)[0];
    if (!hit) return null;
    const surface = { point: hit.point.clone(), type: 'surface' as SnapType };
    const mesh = hit.object as THREE.Mesh;
    const geom = mesh.geometry as THREE.BufferGeometry | undefined;
    if (e.shiftKey || !hit.face || !geom?.attributes?.position) return surface;

    const cursor = new THREE.Vector2(px, py);
    const toPx = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera);
      return new THREE.Vector2((p.x * 0.5 + 0.5) * rect.width, (-p.y * 0.5 + 0.5) * rect.height);
    };
    const pos = geom.attributes.position as THREE.BufferAttribute;
    const m = mesh.matrixWorld;
    const va = new THREE.Vector3().fromBufferAttribute(pos, hit.face.a).applyMatrix4(m);
    const vb = new THREE.Vector3().fromBufferAttribute(pos, hit.face.b).applyMatrix4(m);
    const vc = new THREE.Vector3().fromBufferAttribute(pos, hit.face.c).applyMatrix4(m);

    // Vertex snap (highest priority).
    let bestV: THREE.Vector3 | null = null, bestVd = Infinity;
    for (const v of [va, vb, vc]) { const d = toPx(v).distanceTo(cursor); if (d < bestVd) { bestVd = d; bestV = v; } }
    if (bestV && bestVd <= SNAP_PX) return { point: bestV.clone(), type: 'vertex' };

    // Edge snap: closest point on each triangle edge, measured in screen space.
    let bestE: THREE.Vector3 | null = null, bestEd = Infinity;
    for (const [p0, p1] of [[va, vb], [vb, vc], [vc, va]] as const) {
      const s0 = toPx(p0), s1 = toPx(p1);
      const seg = s1.clone().sub(s0);
      const len2 = seg.lengthSq();
      const t = len2 > 1e-6 ? THREE.MathUtils.clamp(cursor.clone().sub(s0).dot(seg) / len2, 0, 1) : 0;
      const d = s0.clone().lerp(s1, t).distanceTo(cursor);
      if (d < bestEd) { bestEd = d; bestE = p0.clone().lerp(p1, t); }
    }
    if (bestE && bestEd <= SNAP_PX) return { point: bestE, type: 'edge' };

    return surface;
  }

  // ───────────────────────── measurements ─────────────────────────

  private addMeasurement(a: THREE.Vector3, b: THREE.Vector3) {
    // Endpoints are a one-time world-space SNAPSHOT (not re-bound to bodies each frame).
    // Fine here: task objects are welded/static; only the moving arm would drift if measured.
    const id = `m${++this.idCounter}`;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const distance = Math.hypot(dx, dy, dz);

    const objects: THREE.Object3D[] = [];
    // Dimension line (draws over geometry).
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xf59e0b, depthTest: false, transparent: true }));
    line.renderOrder = 1000;
    objects.push(line);
    objects.push(this.makeMarker(a, 0xf59e0b), this.makeMarker(b, 0xf59e0b));

    // Distance label at the midpoint (CSS2D = crisp DOM text).
    const labelEl = document.createElement('div');
    labelEl.textContent = formatLen(distance, this.unit);
    labelEl.style.cssText = 'padding:1px 6px;border-radius:6px;background:#f59e0b;color:#1a1a1a;font:600 11px ui-sans-serif,system-ui;white-space:nowrap;transform:translateY(-2px);';
    const label = new CSS2DObject(labelEl);
    label.position.copy(a).add(b).multiplyScalar(0.5);
    objects.push(label);

    objects.forEach((o) => this.group.add(o));

    const data: Measurement = { id, distance, dx, dy, dz, label: `${id.toUpperCase()}` };
    this.entries.push({ data, a: a.clone(), b: b.clone(), objects, labelEl });
    this.emit();
  }

  private makeMarker(p: THREE.Vector3, color: number): THREE.Mesh {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(0.008, 12, 12),
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true }),
    );
    m.position.copy(p);
    m.renderOrder = 1001;
    return m;
  }

  private clearPending() {
    if (this.pending) { this.disposeObject(this.pending.marker); this.group.remove(this.pending.marker); this.pending = null; }
  }

  private disposeEntry(e: Entry) {
    for (const o of e.objects) { this.group.remove(o); this.disposeObject(o); }
  }

  private disposeObject(o: THREE.Object3D) {
    const mesh = o as THREE.Mesh & THREE.Line;
    mesh.geometry?.dispose?.();
    const mat = mesh.material as THREE.Material | undefined;
    mat?.dispose?.();
    const css = o as unknown as CSS2DObject;
    if (css.element && css.element.parentNode) css.element.parentNode.removeChild(css.element);
  }

  private emit() {
    this.onChange?.(this.entries.map((e) => ({ ...e.data })));
  }
}
