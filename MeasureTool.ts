/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LengthUnit, formatLen } from './types';

/** Screen-space snap radius (CSS px): cursor within this of a vertex/edge/center snaps to it. */
const SNAP_PX = 12;
/** Feature-edge angle (deg): keep sharp edges (box/slab 90°, cylinder rim 90°), drop facet seams. */
const FEATURE_ANGLE = 30;
type SnapType = 'vertex' | 'center' | 'edge' | 'surface';
const SNAP_COLOR: Record<SnapType, number> = { vertex: 0x22c55e, center: 0xa855f7, edge: 0x3b82f6, surface: 0xf59e0b };
const SNAP_NAME: Record<SnapType, string> = { vertex: 'vertex', center: 'center', edge: 'edge', surface: 'surface' };
const AXIS_COLOR = { x: 0xef4444, y: 0x22c55e, z: 0x3b82f6 };

export type MeasureMode = 'point' | 'gap';

export interface Measurement {
  id: string;
  distance: number;
  dx: number; dy: number; dz: number;
  label: string;
  kind: MeasureMode;
}

interface Entry {
  data: Measurement;
  a: THREE.Vector3;
  b: THREE.Vector3;
  objects: THREE.Object3D[]; // line(s) + 2 markers + label, for disposal
  labelEl: HTMLDivElement;
}

/** Per-mesh feature cache (LOCAL space): welded corner vertices, sharp edges, and fitted circles
 *  (cylinder rims etc.). Cached on geometry.uuid; transformed by matrixWorld at snap time so it
 *  stays valid as objects move. */
interface MeshFeatures { uuid: string; verts: THREE.Vector3[]; edges: Array<[THREE.Vector3, THREE.Vector3]>; circles: Array<{ center: THREE.Vector3; radius: number }>; }

/**
 * MeasureTool — CAD-style measurement (à la FreeCAD / OrcaSlicer).
 *
 * POINT mode: click two things → a dimension line + ΔX/ΔY/ΔZ label + an axis-coloured extension
 * "staircase" appear. As the cursor moves it snaps, in screen space (within SNAP_PX), to the
 * hovered mesh's nearest feature VERTEX → circle CENTER → sharp EDGE → exact SURFACE point — so
 * the snap matches what the eye sees regardless of depth. A colour-coded dot + a text tag preview
 * the live snap. Shift forces a free surface point.
 *
 * GAP mode: click two objects → the minimum distance between their meshes (closest-point pair),
 * the key "is this part clear of that one?" layout question.
 *
 * A drag is an orbit, not a pick. Lines/markers draw over geometry; labels are crisp DOM via
 * CSS2DRenderer.
 */
export class MeasureTool {
  active = false;
  readonly group = new THREE.Group();
  onChange: ((list: Measurement[]) => void) | null = null;

  private unit: LengthUnit = 'm';
  private mode: MeasureMode = 'point';
  private prevCursor = '';
  private pending: { point: THREE.Vector3; marker: THREE.Mesh } | null = null;
  private pendingObj: { mesh: THREE.Mesh; marker: THREE.Mesh } | null = null;
  private entries: Entry[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly downPos = new THREE.Vector2();
  private idCounter = 0;
  private readonly hoverMarker: THREE.Mesh;     // live snap preview dot
  private readonly hoverTag: HTMLDivElement;     // live snap type label
  private hoverSnap: { point: THREE.Vector3; type: SnapType; radius?: number } | null = null;

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
    this.hoverTag = document.createElement('div');
    this.hoverTag.style.cssText = 'position:fixed;z-index:50;pointer-events:none;display:none;padding:1px 5px;border-radius:5px;background:rgba(15,23,42,0.88);color:#fff;font:600 10px ui-sans-serif,system-ui;white-space:nowrap;transform:translate(10px,10px);';
    document.body.appendChild(this.hoverTag);
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
    else { this.dom.style.cursor = this.prevCursor; this.clearPending(); this.hoverMarker.visible = false; this.hoverTag.style.display = 'none'; this.hoverSnap = null; }
  }

  /** Point-to-point vs object-to-object minimum gap. Switching clears any half-made pick. */
  setMode(m: MeasureMode) { if (m === this.mode) return; this.mode = m; this.clearPending(); }
  getMode() { return this.mode; }

  setUnit(u: LengthUnit) {
    if (u === this.unit) return;
    this.unit = u;
    for (const e of this.entries) this.renderLabel(e.labelEl, e.data);
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
    this.hoverTag.remove();
    this.scene.remove(this.group);
  }

  // ───────────────────────── picking ─────────────────────────

  private onPointerDown = (e: PointerEvent) => { this.downPos.set(e.clientX, e.clientY); };

  private onPointerLeave = () => {
    if (this.hoverMarker.visible) this.hoverMarker.visible = false;
    this.hoverTag.style.display = 'none';
    this.hoverSnap = null;
  };

  /** Live snap preview: update the hover dot + tag as the cursor moves over geometry. */
  private onPointerMove = (e: PointerEvent) => {
    if (!this.active) return;
    if (this.mode === 'gap') return this.onPointerMoveGap(e);
    const snap = this.computeSnap(e);
    this.hoverSnap = snap;
    if (!snap) { this.hoverMarker.visible = false; this.hoverTag.style.display = 'none'; return; }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.copy(snap.point);
    (this.hoverMarker.material as THREE.MeshBasicMaterial).color.setHex(SNAP_COLOR[snap.type]);
    this.hoverMarker.scale.setScalar(snap.type === 'vertex' || snap.type === 'center' ? 1.5 : 1);
    const tag = snap.type === 'center' && snap.radius ? `center · Ø${formatLen(snap.radius * 2, this.unit)}` : SNAP_NAME[snap.type];
    this.showTag(tag, e);
  };

  /** In gap mode the hover previews the whole object: raycast → mark the surface point. */
  private onPointerMoveGap(e: PointerEvent) {
    const hit = this.raycast(e);
    if (!hit) { this.hoverMarker.visible = false; this.hoverTag.style.display = 'none'; return; }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.copy(hit.point);
    (this.hoverMarker.material as THREE.MeshBasicMaterial).color.setHex(SNAP_COLOR.surface);
    this.hoverMarker.scale.setScalar(1);
    this.showTag(this.pendingObj ? 'object B — gap' : 'object A', e);
  }

  private showTag(text: string, e: PointerEvent) {
    this.hoverTag.textContent = text;
    this.hoverTag.style.display = 'block';
    this.hoverTag.style.left = `${e.clientX}px`;
    this.hoverTag.style.top = `${e.clientY}px`;
  }

  private onPointerUp = (e: PointerEvent) => {
    if (!this.active || e.button !== 0) return;
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) return; // orbit drag, not a pick
    if (this.mode === 'gap') return this.pickObject(e);
    // Prefer the live hover snap (kept fresh by pointermove); recompute as a fallback.
    const snap = this.hoverSnap ?? this.computeSnap(e);
    if (!snap) return;
    const point = snap.point.clone();
    if (!this.pending) {
      const marker = this.makeMarker(point, 0xf59e0b);
      this.group.add(marker);
      this.pending = { point, marker };
    } else {
      this.addMeasurement(this.pending.point, point, 'point');
      this.clearPending();
    }
  };

  /** Gap mode: pick two objects; on the second, measure the minimum distance between them. */
  private pickObject(e: PointerEvent) {
    const hit = this.raycast(e);
    if (!hit) return;
    const mesh = hit.object as THREE.Mesh;
    if (!this.pendingObj) {
      const marker = this.makeMarker(hit.point.clone(), 0xa855f7);
      this.group.add(marker);
      this.pendingObj = { mesh, marker };
    } else if (mesh !== this.pendingObj.mesh) {
      const { a, b } = minMeshDistance(this.pendingObj.mesh, mesh);
      this.addMeasurement(a, b, 'gap');
      this.clearPending();
    }
  }

  private raycast(e: PointerEvent): THREE.Intersection | null {
    const rect = this.dom.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    this.raycaster.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    return this.raycaster.intersectObjects(this.getTargets(), true)[0] ?? null;
  }

  /**
   * Snap engine: raycast the cursor, then test the hovered mesh's cached FEATURE set (welded
   * corner vertices, sharp edges, fitted circle centres) in SCREEN space (≤ SNAP_PX), priority
   * vertex → centre → edge, else the exact SURFACE point. Shift bypasses snapping.
   */
  private computeSnap(e: PointerEvent): { point: THREE.Vector3; type: SnapType; radius?: number } | null {
    const rect = this.dom.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    this.raycaster.setFromCamera(new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1), this.camera);
    const hit = this.raycaster.intersectObjects(this.getTargets(), true)[0];
    if (!hit) return null;
    const surface = { point: hit.point.clone(), type: 'surface' as SnapType };
    const mesh = hit.object as THREE.Mesh;
    const geom = mesh.geometry as THREE.BufferGeometry | undefined;
    if (e.shiftKey || !geom?.attributes?.position) return surface;

    const feat = getFeatures(mesh);
    const m = mesh.matrixWorld;
    const cursor = new THREE.Vector2(px, py);
    const toPx = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera);
      return new THREE.Vector2((p.x * 0.5 + 0.5) * rect.width, (-p.y * 0.5 + 0.5) * rect.height);
    };

    // Vertex snap (highest priority).
    let bestV: THREE.Vector3 | null = null, bestVd = Infinity;
    for (const v of feat.verts) { const w = v.clone().applyMatrix4(m); const d = toPx(w).distanceTo(cursor); if (d < bestVd) { bestVd = d; bestV = w; } }
    if (bestV && bestVd <= SNAP_PX) return { point: bestV, type: 'vertex' };

    // Circle-centre snap (cylinder rims, rings).
    let bestC: { p: THREE.Vector3; r: number } | null = null, bestCd = Infinity;
    for (const c of feat.circles) {
      const w = c.center.clone().applyMatrix4(m);
      const d = toPx(w).distanceTo(cursor);
      if (d < bestCd) { bestCd = d; bestC = { p: w, r: c.radius }; }
    }
    if (bestC && bestCd <= SNAP_PX) return { point: bestC.p, type: 'center', radius: bestC.r };

    // Edge snap: closest point on each sharp edge, in screen space.
    let bestE: THREE.Vector3 | null = null, bestEd = Infinity;
    for (const [p0l, p1l] of feat.edges) {
      const p0 = p0l.clone().applyMatrix4(m), p1 = p1l.clone().applyMatrix4(m);
      const s0 = toPx(p0), s1 = toPx(p1);
      const seg = s1.clone().sub(s0);
      const len2 = seg.lengthSq();
      const t = len2 > 1e-6 ? THREE.MathUtils.clamp(cursor.clone().sub(s0).dot(seg) / len2, 0, 1) : 0;
      const d = s0.clone().lerp(s1, t).distanceTo(cursor);
      if (d < bestEd) { bestEd = d; bestE = p0.lerp(p1, t); }
    }
    if (bestE && bestEd <= SNAP_PX) return { point: bestE, type: 'edge' };

    return surface;
  }

  // ───────────────────────── measurements ─────────────────────────

  private addMeasurement(a: THREE.Vector3, b: THREE.Vector3, kind: MeasureMode) {
    // Endpoints are a one-time world-space SNAPSHOT (not re-bound to bodies each frame).
    const id = `m${++this.idCounter}`;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const distance = Math.hypot(dx, dy, dz);
    const lineColor = kind === 'gap' ? 0xa855f7 : 0xf59e0b;

    const objects: THREE.Object3D[] = [];
    // Direct dimension line (draws over geometry).
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color: lineColor, depthTest: false, transparent: true }),
    );
    line.renderOrder = 1000;
    objects.push(line);
    objects.push(this.makeMarker(a, lineColor), this.makeMarker(b, lineColor));

    // Axis-coloured extension "staircase" a → ΔX → ΔY → ΔZ → b, so the deltas are visible in 3D.
    const c1 = new THREE.Vector3(b.x, a.y, a.z), c2 = new THREE.Vector3(b.x, b.y, a.z);
    objects.push(this.makeAxisLine(a, c1, AXIS_COLOR.x), this.makeAxisLine(c1, c2, AXIS_COLOR.y), this.makeAxisLine(c2, b, AXIS_COLOR.z));

    // Multi-line label at the midpoint (CSS2D = crisp DOM text): total + Δ axes.
    const labelEl = document.createElement('div');
    labelEl.style.cssText = `padding:2px 7px;border-radius:6px;background:${kind === 'gap' ? '#a855f7' : '#f59e0b'};color:#1a1a1a;font:600 11px ui-sans-serif,system-ui;white-space:nowrap;text-align:center;line-height:1.25;transform:translateY(-2px);`;
    const label = new CSS2DObject(labelEl);
    label.position.copy(a).add(b).multiplyScalar(0.5);
    objects.push(label);

    objects.forEach((o) => this.group.add(o));

    const data: Measurement = { id, distance, dx, dy, dz, label: kind === 'gap' ? `Gap ${id.toUpperCase()}` : id.toUpperCase(), kind };
    this.renderLabel(labelEl, data);
    this.entries.push({ data, a: a.clone(), b: b.clone(), objects, labelEl });
    this.emit();
  }

  /** Two-line label: bold total + dim ΔX/ΔY/ΔZ, formatted in the current unit. */
  private renderLabel(el: HTMLDivElement, d: Measurement) {
    const f = (v: number) => formatLen(v, this.unit);
    const top = document.createElement('div'); top.style.fontWeight = '700'; top.textContent = f(d.distance);
    const sub = document.createElement('div'); sub.style.cssText = 'font-size:9px;opacity:0.8;';
    sub.textContent = `Δ ${f(d.dx)}  ${f(d.dy)}  ${f(d.dz)}`;
    el.replaceChildren(top, sub);
  }

  private makeAxisLine(a: THREE.Vector3, b: THREE.Vector3, color: number): THREE.Line {
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([a, b]),
      new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.55 }),
    );
    line.renderOrder = 999;
    return line;
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
    if (this.pendingObj) { this.disposeObject(this.pendingObj.marker); this.group.remove(this.pendingObj.marker); this.pendingObj = null; }
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

// ───────────────────────── feature extraction (module-level, cached on geometry) ─────────────────────────

const featureCache = new WeakMap<THREE.BufferGeometry, MeshFeatures>();

/** Extract (and cache) a mesh's snap features in LOCAL space: welded corner vertices, sharp edges,
 *  and fitted circles (cylinder rims). Keyed on geometry.uuid so it survives object moves. */
function getFeatures(mesh: THREE.Mesh): MeshFeatures {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const cached = featureCache.get(geom);
  if (cached && cached.uuid === geom.uuid) return cached;

  const eg = new THREE.EdgesGeometry(geom, FEATURE_ANGLE);
  const pos = eg.attributes.position as THREE.BufferAttribute;
  const key = (x: number, y: number, z: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
  const vertMap = new Map<string, THREE.Vector3>();
  const edges: Array<[THREE.Vector3, THREE.Vector3]> = [];
  for (let i = 0; i < pos.count; i += 2) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, i);
    const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const ka = key(a.x, a.y, a.z), kb = key(b.x, b.y, b.z);
    if (!vertMap.has(ka)) vertMap.set(ka, a);
    if (!vertMap.has(kb)) vertMap.set(kb, b);
    edges.push([vertMap.get(ka)!, vertMap.get(kb)!]);
  }
  eg.dispose();

  const verts = [...vertMap.values()];
  const circles = detectCircles(verts);
  const feat: MeshFeatures = { uuid: geom.uuid, verts, edges, circles };
  featureCache.set(geom, feat);
  return feat;
}

/** Detect circles (cylinder rims, rings) by bucketing feature vertices into axis-aligned planes,
 *  then keeping buckets whose points are equidistant from their centroid AND spread in 2D (so a
 *  line of points or a box's corners aren't mistaken for a circle). Topology-independent, so it
 *  works on faceted cylinders (a clean degree-2 rim loop is not required). */
function detectCircles(verts: THREE.Vector3[]): Array<{ center: THREE.Vector3; radius: number }> {
  const out: Array<{ center: THREE.Vector3; radius: number }> = [];
  for (let ax = 0; ax < 3; ax++) {
    const buckets = new Map<number, THREE.Vector3[]>();
    for (const v of verts) { const k = Math.round(v.getComponent(ax) * 1000); (buckets.get(k) ?? buckets.set(k, []).get(k)!).push(v); }
    const other = [0, 1, 2].filter((a) => a !== ax);
    for (const pts of buckets.values()) {
      if (pts.length < 8) continue;
      const center = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
      const radii = pts.map((p) => p.distanceTo(center));
      const r = radii.reduce((a, b) => a + b, 0) / radii.length;
      if (r < 1e-4) continue;
      if (Math.max(...radii.map((x) => Math.abs(x - r))) / r > 0.12) continue; // not equidistant → not a circle
      // Both in-plane extents must span the diameter-ish, else it's a collinear row of points.
      if (other.some((a) => { const cs = pts.map((p) => p.getComponent(a)); return Math.max(...cs) - Math.min(...cs) < r; })) continue;
      // Dedupe near-coincident centres found via different axes.
      if (out.some((c) => c.center.distanceTo(center) < r * 0.2)) continue;
      out.push({ center, radius: r });
    }
  }
  return out;
}

// ───────────────────────── object-to-object minimum gap ─────────────────────────

/** Minimum distance between two meshes: nearest vertex-pair, then refined by the closest point on
 *  each mesh's triangles near that pair. Good enough for layout-clearance checks at workcell scale. */
function minMeshDistance(m1: THREE.Mesh, m2: THREE.Mesh): { a: THREE.Vector3; b: THREE.Vector3 } {
  const v1 = worldVerts(m1), v2 = worldVerts(m2);
  let best = Infinity, ba = v1[0] ?? new THREE.Vector3(), bb = v2[0] ?? new THREE.Vector3();
  for (const a of v1) for (const b of v2) { const d = a.distanceToSquared(b); if (d < best) { best = d; ba = a; bb = b; } }
  // Refine: closest point on the *other* mesh's surface to each best vertex (catches face contact).
  const r1 = closestOnMesh(ba, m2); if (r1 && r1.p.distanceTo(ba) < bb.distanceTo(ba)) bb = r1.p;
  const r2 = closestOnMesh(bb, m1); if (r2 && r2.p.distanceTo(bb) < ba.distanceTo(bb)) ba = r2.p;
  return { a: ba, b: bb };
}

/** Deduped world-space vertices of a mesh, capped via stride so dense meshes stay cheap. */
function worldVerts(mesh: THREE.Mesh, cap = 2000): THREE.Vector3[] {
  const pos = (mesh.geometry as THREE.BufferGeometry).attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return [];
  const stride = Math.max(1, Math.ceil(pos.count / cap));
  const m = mesh.matrixWorld;
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < pos.count; i += stride) out.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(m));
  return out;
}

const _tri = new THREE.Triangle();
const _cp = new THREE.Vector3();
const _va = new THREE.Vector3(), _vb = new THREE.Vector3(), _vc = new THREE.Vector3();
/** Closest point on a mesh's triangles to a world point (capped triangle count). */
function closestOnMesh(point: THREE.Vector3, mesh: THREE.Mesh, capTris = 20000): { p: THREE.Vector3; d: number } | null {
  const geom = mesh.geometry as THREE.BufferGeometry;
  const pos = geom.attributes.position as THREE.BufferAttribute | undefined;
  if (!pos) return null;
  const idx = geom.index;
  const m = mesh.matrixWorld;
  const triCount = idx ? idx.count / 3 : pos.count / 3;
  const stride = Math.max(1, Math.ceil(triCount / capTris));
  let best = Infinity, bp: THREE.Vector3 | null = null;
  for (let t = 0; t < triCount; t += stride) {
    const i = t * 3;
    const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
    _va.fromBufferAttribute(pos, a).applyMatrix4(m); _vb.fromBufferAttribute(pos, b).applyMatrix4(m); _vc.fromBufferAttribute(pos, c).applyMatrix4(m);
    _tri.set(_va, _vb, _vc).closestPointToPoint(point, _cp);
    const d = _cp.distanceToSquared(point);
    if (d < best) { best = d; bp = _cp.clone(); }
  }
  return bp ? { p: bp, d: Math.sqrt(best) } : null;
}
