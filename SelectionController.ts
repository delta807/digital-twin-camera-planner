/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type SelectionKind = 'post' | 'object' | 'arm' | 'camera';

export interface SelectionInfo {
  kind: SelectionKind;
  label: string;
  /** World position of the selection (m, origin = table centre). */
  x: number;
  y: number;
  z: number;
  /** Whether the object can be dragged (only the post for now; task objects are welded). */
  movable: boolean;
}

interface PostAxis { x: number; y: number; height: number; width: number }

/**
 * SelectionController — OrcaSlicer-style click-to-select. A pointer *click* (press + release
 * without a drag) raycasts the scene; the hit object gets a yellow bounding-box outline and,
 * if movable (the camera post), a translate gizmo that writes its X/Y back live. Clicking empty
 * space deselects. Orbit is disabled while the gizmo drags. The outline + gizmo live in a group
 * that the caller hides from the sensor PIP. Task objects are welded, so they outline-only.
 */
export class SelectionController {
  readonly group = new THREE.Group();

  private readonly raycaster = new THREE.Raycaster();
  private readonly control: TransformControls;
  private readonly helper: THREE.Object3D;
  private readonly proxy = new THREE.Object3D();   // gizmo attaches here (stable across rebuilds)
  private readonly outline: THREE.LineSegments;

  private selected: SelectionInfo | null = null;
  private selectedBody: THREE.Object3D | null = null; // task-object ref (tracked each frame)
  private readonly box = new THREE.Box3();
  private readonly box2 = new THREE.Box3();
  private readonly vSize = new THREE.Vector3();
  private readonly vCenter = new THREE.Vector3();
  private enabled = true;
  private pointerDown: { x: number; y: number } | null = null;

  onChange?: (sel: SelectionInfo | null) => void;
  onPostMove?: (x: number, y: number) => void;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    private readonly dom: HTMLElement,
    private readonly orbit: OrbitControls,
    private readonly getSelectables: () => THREE.Object3D[],
    private readonly getPostAxis: () => PostAxis,
  ) {
    this.group.name = 'SelectionOverlay';
    this.scene.add(this.group);
    this.scene.add(this.proxy);

    // Yellow unit-box outline (depth-test off so it reads through geometry).
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(boxGeo), // copies edges out; the source box can go now
      new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true }),
    );
    boxGeo.dispose();
    this.outline.renderOrder = 999;
    this.outline.visible = false;
    this.outline.frustumCulled = false;
    this.group.add(this.outline);

    // Translate gizmo (XY plane) for the post.
    this.control = new TransformControls(this.camera, this.dom);
    this.control.setSpace('world');
    this.control.setMode('translate');
    this.control.showZ = false; // the post stands on the table — only slide it in X/Y
    this.control.attach(this.proxy);
    this.control.enabled = false;
    this.control.addEventListener('dragging-changed', (e) => {
      this.orbit.enabled = !(e as unknown as { value: boolean }).value;
    });
    this.control.addEventListener('objectChange', () => {
      if (this.selected?.kind !== 'post') return;
      this.onPostMove?.(this.proxy.position.x, this.proxy.position.y);
    });
    this.helper = this.control.getHelper();
    this.helper.visible = false;
    this.group.add(this.helper);

    this.dom.addEventListener('pointerdown', this.handleDown);
    this.dom.addEventListener('pointerup', this.handleUp);
    this.dom.addEventListener('pointercancel', this.handleCancel);
  }

  /** The outline box of the current selection (sized to it) — for zoom-to-selection framing. */
  get focusTarget(): THREE.Object3D | null {
    return this.selected ? this.outline : null;
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    this.pointerDown = null; // never carry a half-finished press across an enable/disable
    if (!on) this.deselect();
  }

  /**
   * Keep the selection synced each frame: the post rebuilds on edits, and task objects have
   * freejoints so physics (or the pickup sequence) can shove them around — the outline + HUD
   * coordinates must follow, not freeze at the pose captured when the click happened.
   */
  update() {
    if (!this.selected) return;
    const k = this.selected.kind;
    if (k === 'post') {
      const p = this.getPostAxis();
      this.proxy.position.set(p.x, p.y, p.height / 2);
      this.outline.position.set(p.x, p.y, p.height / 2);
      this.outline.scale.set(p.width * 1.6, p.width * 1.6, p.height);
      this.outline.rotation.set(0, 0, 0);
      return;
    }
    // Object / camera bbox the tracked Object3D; arm unions all its links.
    let box: THREE.Box3 | null = null;
    if (k === 'arm') box = this.armBox();
    else if (this.selectedBody) { this.box.setFromObject(this.selectedBody); box = this.box; }
    if (!box || box.isEmpty()) return;
    box.getSize(this.vSize);
    box.getCenter(this.vCenter);
    this.outline.position.copy(this.vCenter);
    this.outline.scale.set(Math.max(this.vSize.x, 0.01), Math.max(this.vSize.y, 0.01), Math.max(this.vSize.z, 0.01));
    this.outline.rotation.set(0, 0, 0);
    // Re-emit only when the centre actually moved (rounded to mm) so the HUD/tree follow.
    const moved = Math.abs(this.vCenter.x - this.selected.x) > 5e-4
      || Math.abs(this.vCenter.y - this.selected.y) > 5e-4
      || Math.abs(this.vCenter.z - this.selected.z) > 5e-4;
    if (moved) {
      this.selected = { ...this.selected, x: this.vCenter.x, y: this.vCenter.y, z: this.vCenter.z };
      this.onChange?.(this.selected);
    }
  }

  private handleDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

  private handleCancel = () => { this.pointerDown = null; };

  private handleUp = (e: PointerEvent) => {
    if (!this.enabled || !this.pointerDown) return;
    const moved = Math.hypot(e.clientX - this.pointerDown.x, e.clientY - this.pointerDown.y);
    this.pointerDown = null;
    if (moved > 6) return;              // a drag (orbit / gizmo), not a click
    if ((this.control as unknown as { dragging: boolean }).dragging) return;

    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Mesh[] = [];
    for (const root of this.getSelectables()) {
      root.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.visible) meshes.push(c as THREE.Mesh); });
    }
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) { this.deselect(); return; }
    this.selectFromHit(hit.object);
  };

  private selectFromHit(obj: THREE.Object3D) {
    // Walk up to the nearest tagged ancestor and dispatch by kind.
    for (let node: THREE.Object3D | null = obj; node; node = node.parent) {
      const s = node.userData?.selectable as string | undefined;
      if (s === 'post') { this.selectPost(); return; }
      if (s === 'object') { this.selectObject(node); return; }
      if (s === 'arm') { this.selectArm(); return; }
      if (s === 'camera') {
        // Outline the whole camera gizmo, not just the lens/body child that was hit.
        let cam = node;
        while (cam.parent && cam.parent.userData?.selectable === 'camera') cam = cam.parent;
        this.selectCamera(cam);
        return;
      }
    }
    this.deselect();
  }

  private selectPost() {
    const p = this.getPostAxis();
    this.selectedBody = null;
    this.control.enabled = true;
    this.helper.visible = true;
    this.outline.visible = true;
    this.selected = { kind: 'post', label: 'Camera post', x: p.x, y: p.y, z: p.height, movable: true };
    this.update();
    this.onChange?.(this.selected);
  }

  private selectObject(body: THREE.Object3D) {
    this.control.enabled = false;
    this.helper.visible = false;
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.selectedBody = body;
    const label = (body.userData.bodyName as string) || `Object ${body.userData.bodyID}`;
    this.box.setFromObject(body);
    this.box.getCenter(this.vCenter);
    this.selected = { kind: 'object', label, x: this.vCenter.x, y: this.vCenter.y, z: this.vCenter.z, movable: false };
    this.update();             // size + position the outline from the live bbox
    this.onChange?.(this.selected);
  }

  /** Select the whole arm (any clicked link) — outline its full bounding box. */
  private selectArm() {
    this.selectedBody = null;
    this.control.enabled = false;
    this.helper.visible = false;
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.selected = { kind: 'arm', label: 'SO-101 arm', x: 0, y: 0, z: 0, movable: true };
    this.update();
    this.onChange?.(this.selected);
  }

  /** Select the D435i camera gizmo — outline it; transform handled by its own move/aim gizmo. */
  private selectCamera(gizmo: THREE.Object3D) {
    this.selectedBody = gizmo;
    this.control.enabled = false;
    this.helper.visible = false;
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.box.setFromObject(gizmo);
    this.box.getCenter(this.vCenter);
    this.selected = { kind: 'camera', label: 'D435i camera', x: this.vCenter.x, y: this.vCenter.y, z: this.vCenter.z, movable: true };
    this.update();
    this.onChange?.(this.selected);
  }

  /** Union world bbox of every mesh tagged selectable='arm' (the arm spans many links). */
  private armBox(): THREE.Box3 | null {
    const box = this.box.makeEmpty();
    for (const root of this.getSelectables()) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || !m.geometry) return;
        let isArm = false;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) {
          if (p.userData?.selectable === 'arm') { isArm = true; break; }
        }
        if (!isArm) return;
        this.box2.setFromObject(m);
        if (!this.box2.isEmpty()) box.union(this.box2);
      });
    }
    return box.isEmpty() ? null : box;
  }

  deselect() {
    if (!this.selected) return;
    this.selected = null;
    this.selectedBody = null;
    this.control.enabled = false;
    this.helper.visible = false;
    this.outline.visible = false;
    this.onChange?.(null);
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.handleDown);
    this.dom.removeEventListener('pointerup', this.handleUp);
    this.dom.removeEventListener('pointercancel', this.handleCancel);
    this.control.detach();
    this.control.dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.scene.remove(this.group, this.proxy);
  }
}
