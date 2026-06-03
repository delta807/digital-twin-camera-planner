/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LengthUnit, formatLen } from './types';

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
 * entry (distance + ΔX/ΔY/ΔZ) is reported to React. Default snaps to the clicked object's
 * centre (good for object-to-object); Shift-click takes the exact surface point (point-to-
 * point). A drag is treated as an orbit, not a pick. Lines/markers draw over geometry; labels
 * are crisp DOM via CSS2DRenderer.
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

  constructor(
    private scene: THREE.Scene,
    private camera: THREE.Camera,
    private dom: HTMLElement,
    private getTargets: () => THREE.Object3D[],
  ) {
    this.group.name = 'Measurements';
    this.scene.add(this.group);
    this.dom.addEventListener('pointerdown', this.onPointerDown);
    this.dom.addEventListener('pointerup', this.onPointerUp);
  }

  setActive(v: boolean) {
    this.active = v;
    // Save/restore the canvas cursor so toggling measure off doesn't clobber another
    // tool's cursor (e.g. a TransformControls grab state) on the shared canvas.
    if (v) { this.prevCursor = this.dom.style.cursor; this.dom.style.cursor = 'crosshair'; }
    else { this.dom.style.cursor = this.prevCursor; this.clearPending(); }
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
    this.clear();
    this.scene.remove(this.group);
  }

  // ───────────────────────── picking ─────────────────────────

  private onPointerDown = (e: PointerEvent) => { this.downPos.set(e.clientX, e.clientY); };

  private onPointerUp = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return;
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) return; // orbit drag, not a pick
    const point = this.pick(e);
    if (!point) return;
    if (!this.pending) {
      const marker = this.makeMarker(point, 0xf59e0b);
      this.group.add(marker);
      this.pending = { point, marker };
    } else {
      this.addMeasurement(this.pending.point, point);
      this.clearPending();
    }
  };

  /** Returns the world-space pick point: object centre by default, exact surface on Shift. */
  private pick(e: PointerEvent): THREE.Vector3 | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.getTargets(), true);
    if (!hits.length) return null;
    if (e.shiftKey) return hits[0].point.clone();
    // Snap to the centre of the clicked object's body group (nicest for object-to-object).
    const body = this.bodyAncestor(hits[0].object);
    const center = new THREE.Vector3();
    new THREE.Box3().setFromObject(body).getCenter(center);
    return center;
  }

  /** Walk up to the nearest ancestor that is a physics body group (has userData.bodyID). */
  private bodyAncestor(obj: THREE.Object3D): THREE.Object3D {
    let o: THREE.Object3D | null = obj;
    while (o) {
      if (o.userData && o.userData.bodyID !== undefined) return o;
      o = o.parent;
    }
    return obj;
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
