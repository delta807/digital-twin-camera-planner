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
  /** World position of the selection centre (m, origin = table centre). */
  x: number;
  y: number;
  z: number;
  /** Whether the object can be moved/edited via the transform panel. */
  movable: boolean;
  /** MuJoCo bodyID for kind==='object' (task block), so the panel can write its freejoint qpos. */
  bodyId?: number;
  /** Arm instance id for kind==='arm' (undefined = the primary physics arm). */
  armId?: string;
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
  private selectedArmId: string | undefined = undefined; // which arm to outline (undefined = primary/physics)
  private readonly box = new THREE.Box3();
  private readonly box2 = new THREE.Box3();
  private readonly vSize = new THREE.Vector3();
  private readonly vCenter = new THREE.Vector3();
  private enabled = true;
  private pointerDown: { x: number; y: number } | null = null;

  onChange?: (sel: SelectionInfo | null) => void;
  onPostMove?: (x: number, y: number) => void;
  onArmMove?: (armId: string | undefined, x: number, y: number) => void;
  /** App provides the selected arm's base pose so the gizmo can sit on it + track it. */
  getArmPose?: (armId: string | undefined) => { x: number; y: number } | null;

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
      if (this.selected?.kind === 'arm') { this.onArmMove?.(this.selected.armId, this.proxy.position.x, this.proxy.position.y); return; }
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

  /** Programmatic selection (from the object tree), without a viewport raycast. */
  selectByKind(kind: 'arm' | 'post' | 'camera', armId?: string) {
    if (kind === 'arm') return this.selectArm(armId);
    if (kind === 'post') return this.selectPost();
    for (const root of this.getSelectables()) {
      if (root.userData?.selectable === 'camera') { this.selectCamera(root); return; }
    }
  }

  /** Select a task block by its MuJoCo bodyID (from the object tree). */
  selectObjectByBodyId(id: number) {
    for (const root of this.getSelectables()) {
      let found: THREE.Object3D | null = null;
      root.traverse((o) => { if (!found && o.userData?.selectable === 'object' && o.userData?.bodyID === id) found = o; });
      if (found) { this.selectObject(found); return; }
    }
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
    if (k === 'arm') {
      box = this.armBox(this.selectedArmId);
      const pose = this.getArmPose?.(this.selectedArmId); // keep the drag gizmo on the arm base
      if (pose && !(this.control as unknown as { dragging: boolean }).dragging) this.proxy.position.set(pose.x, pose.y, 0.02);
    } else if (this.selectedBody) { this.box.setFromObject(this.selectedBody); box = this.box; }
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
    // Pick the CLOSEST hit that actually has a selectable ancestor — skip non-selectable occluders
    // (e.g. extra mount posts, which aren't selectable). Otherwise clicking near/through an extra
    // post would land on it, find nothing selectable, and wrongly DESELECT the camera post (#8).
    const hits = this.raycaster.intersectObjects(meshes, false);
    const hasSelectable = (o: THREE.Object3D) => {
      for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n.userData?.selectable) return true;
      return false;
    };
    const hit = hits.find((h) => hasSelectable(h.object));
    if (!hit) { this.deselect(); return; }
    this.selectFromHit(hit.object);
  };

  private selectFromHit(obj: THREE.Object3D) {
    // Walk up to the nearest tagged ancestor and dispatch by kind.
    for (let node: THREE.Object3D | null = obj; node; node = node.parent) {
      const s = node.userData?.selectable as string | undefined;
      if (s === 'post') { this.selectPost(); return; }
      if (s === 'object') { this.selectObject(node); return; }
      if (s === 'arm') { this.selectArm(node.userData?.armId as string | undefined); return; }
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
    this.selected = { kind: 'object', label, x: this.vCenter.x, y: this.vCenter.y, z: this.vCenter.z, movable: true, bodyId: body.userData.bodyID as number };
    this.update();             // size + position the outline from the live bbox
    this.onChange?.(this.selected);
  }

  /** Select a specific arm (by id; undefined = the primary physics arm) — outline + drag gizmo. */
  private selectArm(armId?: string) {
    this.selectedArmId = armId;
    this.selectedBody = null;
    const pose = this.getArmPose?.(armId);
    if (pose) this.proxy.position.set(pose.x, pose.y, 0.02);
    this.control.enabled = !!pose;   // XY translate gizmo on the arm base, like the camera's
    this.helper.visible = !!pose;
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.selected = { kind: 'arm', label: 'SO-101 arm', x: 0, y: 0, z: 0, movable: true, armId };
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

  /**
   * Union world bbox of one arm's links. A non-primary arm is a ghost clone tagged with its armId;
   * the primary physics arm's links carry no armId. So if `armId` matches ghost links, outline
   * those; otherwise (primary) outline the physics arm links (the ones with no armId).
   */
  private armBox(armId?: string): THREE.Box3 | null {
    if (armId) { const ghost = this.unionArmMeshes(armId); if (ghost) return ghost; }
    return this.unionArmMeshes(undefined);
  }

  private unionArmMeshes(armId?: string): THREE.Box3 | null {
    const box = this.box.makeEmpty();
    for (const root of this.getSelectables()) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || !m.geometry) return;
        let isArm = false, meshArmId: string | undefined;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) {
          if (p.userData?.selectable === 'arm') { isArm = true; meshArmId = p.userData.armId as string | undefined; break; }
        }
        if (!isArm) return;
        if (armId === undefined ? meshArmId !== undefined : meshArmId !== armId) return; // physics vs a specific ghost
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
