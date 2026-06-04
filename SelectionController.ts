/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type SelectionKind = 'post' | 'object';

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
    this.outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)),
      new THREE.LineBasicMaterial({ color: 0xfacc15, depthTest: false, transparent: true }),
    );
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
  }

  setEnabled(on: boolean) {
    this.enabled = on;
    if (!on) this.deselect();
  }

  /** Keep the post outline + gizmo synced to the live post each frame (it rebuilds on edits). */
  update() {
    if (this.selected?.kind === 'post') {
      const p = this.getPostAxis();
      this.proxy.position.set(p.x, p.y, p.height / 2);
      this.outline.position.set(p.x, p.y, p.height / 2);
      this.outline.scale.set(p.width * 1.6, p.width * 1.6, p.height);
      this.outline.rotation.set(0, 0, 0);
    }
  }

  private handleDown = (e: PointerEvent) => {
    if (!this.enabled || e.button !== 0) return;
    this.pointerDown = { x: e.clientX, y: e.clientY };
  };

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
    // Post?
    let node: THREE.Object3D | null = obj;
    while (node) {
      if (node.userData?.selectable === 'post') { this.selectPost(); return; }
      node = node.parent;
    }
    // Task object? Only bodies explicitly tagged selectable='object' (demo props) — never the
    // arm links or the worldbody floor, which would otherwise swallow every click.
    const body = this.selectableBodyAncestor(obj);
    if (body) { this.selectObject(body); return; }
    this.deselect();
  }

  private selectableBodyAncestor(obj: THREE.Object3D): THREE.Object3D | null {
    let node: THREE.Object3D | null = obj;
    while (node) {
      if (node.userData?.selectable === 'object') return node;
      node = node.parent;
    }
    return null;
  }

  private selectPost() {
    const p = this.getPostAxis();
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
    const box = new THREE.Box3().setFromObject(body);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    this.outline.position.copy(c);
    this.outline.scale.set(Math.max(size.x, 0.01), Math.max(size.y, 0.01), Math.max(size.z, 0.01));
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    const label = (body.userData.bodyName as string) || `Object ${body.userData.bodyID}`;
    this.selected = { kind: 'object', label, x: c.x, y: c.y, z: c.z, movable: false };
    this.onChange?.(this.selected);
  }

  deselect() {
    if (!this.selected) return;
    this.selected = null;
    this.control.enabled = false;
    this.helper.visible = false;
    this.outline.visible = false;
    this.onChange?.(null);
  }

  dispose() {
    this.dom.removeEventListener('pointerdown', this.handleDown);
    this.dom.removeEventListener('pointerup', this.handleUp);
    this.control.detach();
    this.control.dispose();
    this.outline.geometry.dispose();
    (this.outline.material as THREE.Material).dispose();
    this.scene.remove(this.group, this.proxy);
  }
}
