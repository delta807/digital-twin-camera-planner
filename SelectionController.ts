/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';

export type SelectionKind = 'post' | 'object' | 'arm' | 'camera' | 'station' | 'wristcam' | 'prop';

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
  /** Workstation id for kind==='station'. */
  stationId?: string;
  /** Extra-camera id for kind==='camera' (undefined = the primary D435i, moved by its own rig). */
  cameraId?: string;
  /** Arm id for kind==='wristcam' (the gripper-mounted wrist camera). */
  wristArmId?: string;
  /** Decoupled prop id for kind==='prop' (a non-physics Three.js cube). */
  propId?: string;
  /** Extra mount-post index for kind==='post' (undefined = the main camera post). */
  postIndex?: number;
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
  /** The current selection (read-only) — used by RenderSystem to gate the camera rig's gizmo. */
  get current(): SelectionInfo | null { return this.selected; }
  private selectedBody: THREE.Object3D | null = null; // task-object ref (tracked each frame)
  private selectedArmId: string | undefined = undefined; // which arm to outline (undefined = primary/physics)
  private readonly box = new THREE.Box3();
  private readonly box2 = new THREE.Box3();
  private readonly vSize = new THREE.Vector3();
  private readonly vCenter = new THREE.Vector3();
  private enabled = true;
  private skipArm = false;
  // Magnetic snap targets (world): rail midpoints / corners / post tops. While dragging, the gizmo
  // snaps to the nearest within SNAP_DIST and a coloured marker flags it (FreeCAD/Fusion inference).
  private snapTargets: Array<{ x: number; y: number; z?: number; kind: 'mid' | 'corner' | 'post' }> = [];
  private snapMarker!: THREE.Mesh;
  private pointerDown: { x: number; y: number } | null = null;

  onChange?: (sel: SelectionInfo | null) => void;
  onPostMove?: (x: number, y: number) => void;
  // Extra mount posts (selectable by index): move via the proxy gizmo; pose read back each frame.
  onExtraPostMove?: (index: number, x: number, y: number) => void;
  getExtraPostPose?: (index: number) => { x: number; y: number; height: number } | null;
  private selectedPostIndex: number | undefined = undefined;
  onArmMove?: (armId: string | undefined, x: number, y: number) => void;
  /** Arm "aim" gizmo (rotate mode) → write the base yaw (radians). */
  onArmRotate?: (armId: string | undefined, yaw: number) => void;
  /** App provides the selected arm's base pose so the gizmo can sit on it + track it. */
  getArmPose?: (armId: string | undefined) => { x: number; y: number; yaw?: number } | null;
  private armAim = false; // arm gizmo in rotate (aim) mode vs translate (move)
  // Stations reuse the exact same move/aim gizmo machinery as the arm (DRY).
  onStationMove?: (id: string, x: number, y: number) => void;
  onStationRotate?: (id: string, yaw: number) => void;
  getStationPose?: (id: string) => { x: number; y: number; yaw: number } | null;
  private selectedStationId: string | undefined = undefined;
  private stationAim = false;
  // Extra overhead cameras reuse the proxy gizmo for move (translate) + aim (rotate).
  onCameraMove?: (id: string, x: number, y: number, z: number) => void;
  onCameraAim?: (id: string, rx: number, ry: number, rz: number) => void;
  getCameraPose?: (id: string) => { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number } | null;
  private selectedCameraId: string | undefined = undefined;
  private cameraAim = false;
  // Wrist camera (gripper-mounted): move = world position → local offset; aim = world quat → tilt.
  onWristMove?: (armId: string, world: THREE.Vector3) => void;
  onWristAim?: (armId: string, quat: THREE.Quaternion) => void;
  getWristPose?: (armId: string) => { pos: THREE.Vector3; quat: THREE.Quaternion } | null;
  private selectedWristArmId: string | undefined = undefined;
  private wristAim = false;
  // Task objects (boxes) reuse the proxy gizmo: move = teleport freejoint XY; aim = yaw about Z.
  onObjectMove?: (bodyId: number, x: number, y: number, z: number) => void;
  onObjectRotate?: (bodyId: number, yaw: number) => void;
  private objectAim = false;
  // Decoupled props (Three.js cubes): id-based selection (the mesh is rebuilt on every config edit).
  onPropMove?: (id: string, x: number, y: number, z: number) => void;
  onPropRotate?: (id: string, yaw: number) => void;
  getPropPose?: (id: string) => { x: number; y: number; z: number; yaw: number } | null;
  private selectedPropId: string | undefined = undefined;
  private propAim = false;

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

    // Drag-time magnetic-snap marker (flat ring on the ground, recoloured per target kind).
    this.snapMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.018, 0.03, 28),
      new THREE.MeshBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.95, side: THREE.DoubleSide, depthTest: false }),
    );
    this.snapMarker.renderOrder = 1002;
    this.snapMarker.visible = false;
    this.scene.add(this.snapMarker);

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
      const dragging = (e as unknown as { value: boolean }).value;
      this.orbit.enabled = !dragging;
      if (!dragging) this.snapMarker.visible = false; // clear the snap glyph when the drag ends
    });
    this.control.addEventListener('objectChange', () => {
      this.maybeSnap(); // magnetic snap (mutates proxy.position) before the write-backs read it
      if (this.selected?.kind === 'arm') {
        if (this.armAim) this.onArmRotate?.(this.selected.armId, this.proxy.rotation.z);
        else this.onArmMove?.(this.selected.armId, this.proxy.position.x, this.proxy.position.y);
        return;
      }
      if (this.selected?.kind === 'station') {
        if (this.stationAim) this.onStationRotate?.(this.selected.stationId!, this.proxy.rotation.z);
        else this.onStationMove?.(this.selected.stationId!, this.proxy.position.x, this.proxy.position.y);
        return;
      }
      if (this.selected?.kind === 'camera' && this.selected.cameraId) {
        if (this.cameraAim) this.onCameraAim?.(this.selected.cameraId, this.proxy.rotation.x, this.proxy.rotation.y, this.proxy.rotation.z);
        else this.onCameraMove?.(this.selected.cameraId, this.proxy.position.x, this.proxy.position.y, this.proxy.position.z);
        return;
      }
      if (this.selected?.kind === 'wristcam') {
        if (this.wristAim) this.onWristAim?.(this.selected.wristArmId!, this.proxy.quaternion);
        else this.onWristMove?.(this.selected.wristArmId!, this.proxy.position);
        return;
      }
      if (this.selected?.kind === 'object' && this.selected.bodyId !== undefined) {
        if (this.objectAim) this.onObjectRotate?.(this.selected.bodyId, this.proxy.rotation.z);
        else this.onObjectMove?.(this.selected.bodyId, this.proxy.position.x, this.proxy.position.y, this.proxy.position.z);
        return;
      }
      if (this.selected?.kind === 'prop' && this.selected.propId) {
        if (this.propAim) this.onPropRotate?.(this.selected.propId, this.proxy.rotation.z);
        else this.onPropMove?.(this.selected.propId, this.proxy.position.x, this.proxy.position.y, this.proxy.position.z);
        return;
      }
      if (this.selected?.kind !== 'post') return;
      if (this.selected.postIndex !== undefined) this.onExtraPostMove?.(this.selected.postIndex, this.proxy.position.x, this.proxy.position.y);
      else this.onPostMove?.(this.proxy.position.x, this.proxy.position.y);
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
  selectByKind(kind: 'arm' | 'post' | 'camera' | 'station' | 'wristcam' | 'prop', id?: string) {
    if (kind === 'arm') return this.selectArm(id);
    if (kind === 'post') return this.selectPost(id !== undefined && id !== '' ? Number(id) : undefined);
    if (kind === 'station') { if (id) this.selectStation(id); return; }
    if (kind === 'wristcam') { if (id) this.selectWristCam(id); return; }
    if (kind === 'prop') { if (id) this.selectProp(id); return; }
    // camera: match the cameraId (undefined = primary rig gizmo; an id = that extra camera's glyph).
    for (const root of this.getSelectables()) {
      if (root.userData?.selectable === 'camera' && (root.userData?.cameraId as string | undefined) === id) { this.selectCamera(root); return; }
    }
  }

  /** Raycast at a screen point, select what's there, and return its kind — for the right-click
   *  radial menu (so it knows which modes to offer for the object under the cursor). */
  selectAt(clientX: number, clientY: number): SelectionKind | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes: THREE.Mesh[] = [];
    for (const root of this.getSelectables()) root.traverse((c) => { if ((c as THREE.Mesh).isMesh && c.visible) meshes.push(c as THREE.Mesh); });
    const hasSelectable = (o: THREE.Object3D) => { for (let n: THREE.Object3D | null = o; n; n = n.parent) if (n.userData?.selectable) return true; return false; };
    const hit = this.raycaster.intersectObjects(meshes, false).find((h) => hasSelectable(h.object));
    if (!hit) return null;
    this.selectFromHit(hit.object);
    return this.selected?.kind ?? null;
  }

  /** Switch the ARM gizmo between Move (translate on XY) and Aim (rotate the base yaw). */
  setArmAim(rotate: boolean) {
    this.armAim = rotate;
    if (this.selected?.kind !== 'arm') return;
    if (rotate) {
      const pose = this.getArmPose?.(this.selectedArmId);
      this.proxy.rotation.z = pose?.yaw ?? 0;
      this.control.setMode('rotate');
      this.control.showX = false; this.control.showY = false; this.control.showZ = true;
    } else {
      this.proxy.rotation.z = 0;
      this.control.setMode('translate');
      this.control.showX = true; this.control.showY = true; this.control.showZ = false;
    }
    this.control.enabled = true;
    this.helper.visible = true;
  }

  /** Switch the STATION gizmo between Move (translate on XY) and Aim (rotate yaw) — same as the arm. */
  setStationAim(rotate: boolean) {
    this.stationAim = rotate;
    if (this.selected?.kind !== 'station') return;
    const pose = this.getStationPose?.(this.selectedStationId!);
    if (rotate) {
      this.proxy.rotation.z = pose?.yaw ?? 0;
      this.control.setMode('rotate');
      this.control.showX = false; this.control.showY = false; this.control.showZ = true;
    } else {
      this.proxy.rotation.z = pose?.yaw ?? 0; // keep the gizmo aligned with the rotated worktop
      this.control.setMode('translate');
      this.control.showX = true; this.control.showY = true; this.control.showZ = false;
    }
    this.control.enabled = true;
    this.helper.visible = true;
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

  /** Candidate magnetic-snap targets (world coords): rail midpoints, corners, post tops. */
  setSnapTargets(t: Array<{ x: number; y: number; z?: number; kind: 'mid' | 'corner' | 'post' }>) { this.snapTargets = t; }

  /** During a translate drag, snap the gizmo to the nearest relevant target within SNAP_DIST and
   *  show a marker (cyan = rail midpoint, amber = corner, violet = post top). Cameras snap to post
   *  tops (XYZ); everything else snaps on the floor (XY). No-op while aiming/rotating. */
  private maybeSnap() {
    const k = this.selected?.kind;
    const aiming = this.armAim || this.stationAim || this.cameraAim || this.objectAim || this.propAim || this.wristAim;
    if (aiming || !this.snapTargets.length || !k) { this.snapMarker.visible = false; return; }
    const wantPost = k === 'camera'; // cameras mount on post tops; floor objects on rails/corners
    const px = this.proxy.position.x, py = this.proxy.position.y;
    let best: { x: number; y: number; z?: number; kind: string } | null = null, bestD = Infinity;
    for (const t of this.snapTargets) {
      if (wantPost ? t.kind !== 'post' : t.kind === 'post') continue;
      const d = Math.hypot(t.x - px, t.y - py);
      if (d < bestD) { bestD = d; best = t; }
    }
    const SNAP_DIST = 0.045;
    if (best && bestD < SNAP_DIST) {
      this.proxy.position.x = best.x; this.proxy.position.y = best.y;
      if (wantPost && best.z != null) this.proxy.position.z = best.z;
      (this.snapMarker.material as THREE.MeshBasicMaterial).color.setHex(best.kind === 'mid' ? 0x2dd4bf : best.kind === 'corner' ? 0xf59e0b : 0x8b5cf6);
      this.snapMarker.position.set(best.x, best.y, (best.z ?? 0) + 0.012);
      this.snapMarker.visible = true;
    } else {
      this.snapMarker.visible = false;
    }
  }

  /** Jog/pose mode: keep selection live for everything EXCEPT the arm (whose link clicks drive
   *  joints via MujocoJointDrag). Lets you still click cameras / stations / posts / objects while
   *  jogging, instead of selection being globally off. */
  setSkipArm(on: boolean) {
    this.skipArm = on;
    if (on && this.selected?.kind === 'arm') this.deselect();
  }

  /** First selectable kind on the ancestor chain of a hit object (null if none). */
  private kindOfHit(obj: THREE.Object3D): string | null {
    for (let n: THREE.Object3D | null = obj; n; n = n.parent) {
      const s = n.userData?.selectable as string | undefined;
      if (s) return s;
    }
    return null;
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
      const main = this.getPostAxis();
      const ep = this.selectedPostIndex !== undefined ? this.getExtraPostPose?.(this.selectedPostIndex) : null;
      const p = ep ? { x: ep.x, y: ep.y, height: ep.height, width: main.width } : main;
      if (!(this.control as unknown as { dragging: boolean }).dragging) this.proxy.position.set(p.x, p.y, p.height / 2);
      this.outline.position.set(p.x, p.y, p.height / 2);
      this.outline.scale.set(p.width * 1.6, p.width * 1.6, p.height);
      this.outline.rotation.set(0, 0, 0);
      return;
    }
    // Object / camera bbox the tracked Object3D; arm + station union their meshes.
    let box: THREE.Box3 | null = null;
    if (k === 'arm') {
      box = this.armBox(this.selectedArmId);
      const pose = this.getArmPose?.(this.selectedArmId); // keep the drag gizmo on the arm base
      if (pose && !(this.control as unknown as { dragging: boolean }).dragging) this.proxy.position.set(pose.x, pose.y, 0.02);
    } else if (k === 'station') {
      box = this.stationBox(this.selectedStationId);
      const pose = this.getStationPose?.(this.selectedStationId!); // keep the gizmo on the station centre
      if (pose && !(this.control as unknown as { dragging: boolean }).dragging) { this.proxy.position.set(pose.x, pose.y, 0.05); this.proxy.rotation.z = pose.yaw; }
    } else if (k === 'prop') {
      box = this.propBox(this.selectedPropId);
      const pose = this.getPropPose?.(this.selectedPropId!); // keep the gizmo on the prop (rebuilt on edits)
      if (pose && !(this.control as unknown as { dragging: boolean }).dragging) { this.proxy.position.set(pose.x, pose.y, pose.z); this.proxy.rotation.z = pose.yaw; }
    } else if (k === 'camera' && this.selectedCameraId) {
      if (this.selectedBody) { this.box.setFromObject(this.selectedBody); box = this.box; }
      const pose = this.getCameraPose?.(this.selectedCameraId); // keep the gizmo on the camera body
      if (pose && !(this.control as unknown as { dragging: boolean }).dragging) {
        this.proxy.position.set(pose.x, pose.y, pose.z);
        if (this.cameraAim) this.proxy.rotation.set(pose.rotX, pose.rotY, pose.rotZ);
      }
    } else if (k === 'wristcam' && this.selectedWristArmId) {
      // The wrist cam rides the gripper — keep the gizmo + outline on it (unless mid-drag).
      const pose = this.getWristPose?.(this.selectedWristArmId);
      if (pose) {
        this.box.setFromCenterAndSize(pose.pos, this.vSize.set(0.06, 0.06, 0.06)); box = this.box;
        if (!(this.control as unknown as { dragging: boolean }).dragging) { this.proxy.position.copy(pose.pos); this.proxy.quaternion.copy(pose.quat); }
      }
    } else if (this.selectedBody) {
      this.box.setFromObject(this.selectedBody); box = this.box;
      // Keep the move/aim gizmo on the box centre (unless mid-drag) so physics nudges don't desync it.
      if (this.selected.kind === 'object' && this.control.enabled && !(this.control as unknown as { dragging: boolean }).dragging) {
        this.box.getCenter(this.vCenter); this.proxy.position.copy(this.vCenter);
      }
    }
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
    // In jog mode, an arm-link click is a joint drag (handled by MujocoJointDrag) — don't let it
    // select (or deselect) anything; everything else still selects normally.
    if (this.skipArm && this.kindOfHit(hit.object) === 'arm') return;
    this.selectFromHit(hit.object);
  };

  private selectFromHit(obj: THREE.Object3D) {
    // Walk up to the nearest tagged ancestor and dispatch by kind.
    for (let node: THREE.Object3D | null = obj; node; node = node.parent) {
      const s = node.userData?.selectable as string | undefined;
      if (s === 'post') { this.selectPost(node.userData?.postIndex as number | undefined); return; }
      if (s === 'object') { this.selectObject(node); return; }
      if (s === 'arm') { this.selectArm(node.userData?.armId as string | undefined); return; }
      if (s === 'station') { this.selectStation(node.userData?.stationId as string); return; }
      if (s === 'wristcam') { this.selectWristCam(node.userData?.armId as string); return; }
      if (s === 'prop') { this.selectProp(node.userData?.propId as string); return; }
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

  private selectPost(index?: number) {
    this.selectedPostIndex = index;
    this.selectedBody = null;
    const ep = index !== undefined ? this.getExtraPostPose?.(index) : null;
    const p = ep ?? this.getPostAxis();
    this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = false;
    this.proxy.rotation.set(0, 0, 0);
    this.control.enabled = true;
    this.helper.visible = true;
    this.outline.visible = true;
    this.selected = { kind: 'post', label: index !== undefined ? `Mount post ${index + 2}` : 'Camera post', x: p.x, y: p.y, z: ('height' in p ? p.height : 0), movable: true, postIndex: index };
    this.update();
    this.onChange?.(this.selected);
  }

  private selectObject(body: THREE.Object3D) {
    this.objectAim = false; // fresh selection starts in move (translate) mode
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.selectedBody = body;
    const label = (body.userData.bodyName as string) || `Object ${body.userData.bodyID}`;
    this.box.setFromObject(body);
    this.box.getCenter(this.vCenter);
    // XY-translate gizmo so a box can be dragged across the table (Z kept; numeric field still edits it).
    const dynamic = body.userData.dynamic !== false; // only freejoint blocks can be moved
    this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = false;
    this.proxy.rotation.set(0, 0, 0);
    this.proxy.position.copy(this.vCenter);
    this.control.enabled = dynamic; this.helper.visible = dynamic;
    this.selected = { kind: 'object', label, x: this.vCenter.x, y: this.vCenter.y, z: this.vCenter.z, movable: true, bodyId: body.userData.bodyID as number };
    this.update();             // size + position the outline from the live bbox
    this.onChange?.(this.selected);
  }

  /** Switch a selected task object between Move (translate XY) and Aim (rotate about Z). */
  setObjectAim(rotate: boolean) {
    this.objectAim = rotate;
    if (this.selected?.kind !== 'object') return;
    if (rotate) { this.control.setMode('rotate'); this.control.showX = false; this.control.showY = false; this.control.showZ = true; }
    else { this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = false; }
    this.control.enabled = true; this.helper.visible = true;
  }

  /** World point on the table plane (z=0) under a screen pixel — for "create here" on empty space. */
  groundPointAt(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const hit = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(plane, hit) ? { x: hit.x, y: hit.y } : null;
  }

  /** Select a specific arm (by id; undefined = the primary physics arm) — outline + drag gizmo. */
  private selectArm(armId?: string) {
    this.selectedArmId = armId;
    this.selectedBody = null;
    this.armAim = false; // a fresh arm selection starts in move (translate) mode
    this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = false;
    this.proxy.rotation.set(0, 0, 0);
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

  /** Select the gripper-mounted wrist camera — move/aim gizmo on it (like the D435i, but gripper-
   *  relative: move sets its local offset, aim sets its tilt). */
  private selectWristCam(armId: string) {
    this.selectedWristArmId = armId;
    this.selectedBody = null;
    this.wristAim = false;
    this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = true;
    const pose = this.getWristPose?.(armId);
    if (pose) { this.proxy.position.copy(pose.pos); this.proxy.quaternion.copy(pose.quat); }
    this.control.enabled = !!pose; this.helper.visible = !!pose;
    this.outline.rotation.set(0, 0, 0); this.outline.visible = true;
    this.selected = { kind: 'wristcam', label: 'Wrist camera', x: pose?.pos.x ?? 0, y: pose?.pos.y ?? 0, z: pose?.pos.z ?? 0, movable: true, wristArmId: armId };
    this.update();
    this.onChange?.(this.selected);
  }

  /** Switch the wrist-cam gizmo between Move (translate) and Aim (rotate). */
  setWristCamAim(rotate: boolean) {
    this.wristAim = rotate;
    if (this.selected?.kind !== 'wristcam') return;
    this.control.setMode(rotate ? 'rotate' : 'translate');
    this.control.showX = true; this.control.showY = true; this.control.showZ = true;
    this.control.enabled = true; this.helper.visible = true;
  }

  /** Select a workstation worktop — outline it + drag/rotate gizmo at its centre (same as the arm). */
  private selectStation(id: string) {
    this.selectedStationId = id;
    this.selectedBody = null;
    this.stationAim = false; // fresh selection starts in move (translate) mode
    this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = false;
    const pose = this.getStationPose?.(id);
    this.proxy.rotation.set(0, 0, pose?.yaw ?? 0);
    if (pose) this.proxy.position.set(pose.x, pose.y, 0.05);
    this.control.enabled = !!pose;
    this.helper.visible = !!pose;
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.selected = { kind: 'station', label: id === 'primary' ? 'Workcell (table)' : 'Workstation', x: pose?.x ?? 0, y: pose?.y ?? 0, z: 0, movable: true, stationId: id };
    this.update();
    this.onChange?.(this.selected);
  }

  /** Select a D435i camera gizmo. The PRIMARY (no cameraId) is moved by its own rig — outline only.
   *  An EXTRA camera (cameraId) gets the shared proxy gizmo: translate to move, rotate to aim. */
  private selectCamera(gizmo: THREE.Object3D) {
    const cameraId = gizmo.userData?.cameraId as string | undefined;
    this.selectedBody = gizmo;
    this.selectedCameraId = cameraId;
    this.cameraAim = false;
    this.outline.rotation.set(0, 0, 0);
    this.outline.visible = true;
    this.box.setFromObject(gizmo);
    this.box.getCenter(this.vCenter);
    if (cameraId) {
      // Extra camera: full XYZ translate gizmo on the body (cameras float in the air, so Z matters).
      const pose = this.getCameraPose?.(cameraId);
      this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = true;
      this.proxy.rotation.set(pose?.rotX ?? 0, pose?.rotY ?? 0, pose?.rotZ ?? 0);
      if (pose) this.proxy.position.set(pose.x, pose.y, pose.z);
      this.control.enabled = !!pose; this.helper.visible = !!pose;
    } else {
      this.control.enabled = false; this.helper.visible = false; // primary: rig owns the gizmo
    }
    this.selected = { kind: 'camera', label: cameraId ? 'Overhead D435i' : 'D435i camera', x: this.vCenter.x, y: this.vCenter.y, z: this.vCenter.z, movable: true, cameraId };
    this.update();
    this.onChange?.(this.selected);
  }

  /** Switch an EXTRA camera's gizmo between Move (translate XYZ) and Aim (rotate XYZ). */
  setCameraAim(rotate: boolean) {
    this.cameraAim = rotate;
    if (this.selected?.kind !== 'camera' || !this.selectedCameraId) return;
    const pose = this.getCameraPose?.(this.selectedCameraId);
    if (rotate) {
      this.proxy.rotation.set(pose?.rotX ?? 0, pose?.rotY ?? 0, pose?.rotZ ?? 0);
      this.control.setMode('rotate'); this.control.showX = true; this.control.showY = true; this.control.showZ = true;
    } else {
      this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = true;
    }
    this.control.enabled = true; this.helper.visible = true;
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

  /** Union world bbox of one station's slab + rails (tagged selectable='station' with this id). */
  private stationBox(id: string | undefined): THREE.Box3 | null {
    if (!id) return null;
    const box = this.box.makeEmpty();
    for (const root of this.getSelectables()) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || !m.geometry) return;
        let match = false;
        for (let p: THREE.Object3D | null = o; p; p = p.parent) {
          if (p.userData?.selectable === 'station') { match = p.userData.stationId === id; break; }
        }
        if (!match) return;
        this.box2.setFromObject(m);
        if (!this.box2.isEmpty()) box.union(this.box2);
      });
    }
    return box.isEmpty() ? null : box;
  }

  /** Union world bbox of one prop cube (tagged selectable='prop' with this id). */
  private propBox(id: string | undefined): THREE.Box3 | null {
    if (!id) return null;
    const box = this.box.makeEmpty();
    for (const root of this.getSelectables()) {
      root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh || !m.visible || !m.geometry) return;
        if (m.userData?.selectable !== 'prop' || m.userData?.propId !== id) return;
        this.box2.setFromObject(m);
        if (!this.box2.isEmpty()) box.union(this.box2);
      });
    }
    return box.isEmpty() ? null : box;
  }

  /** Select a decoupled prop by id. Id-based (the mesh is recreated on every config edit), with a
   *  full XYZ-translate / Z-rotate gizmo — props float freely, unlike on-rail items. */
  private selectProp(id: string) {
    this.selectedPropId = id;
    this.selectedBody = null;
    this.propAim = false;
    this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = true;
    const pose = this.getPropPose?.(id);
    this.proxy.rotation.set(0, 0, pose?.yaw ?? 0);
    if (pose) this.proxy.position.set(pose.x, pose.y, pose.z);
    this.control.enabled = !!pose; this.helper.visible = !!pose;
    this.outline.rotation.set(0, 0, 0); this.outline.visible = true;
    this.selected = { kind: 'prop', label: 'Prop', x: pose?.x ?? 0, y: pose?.y ?? 0, z: pose?.z ?? 0, movable: true, propId: id };
    this.update();
    this.onChange?.(this.selected);
  }

  /** Switch a prop's gizmo between Move (translate XYZ) and Aim (rotate about Z). */
  setPropAim(rotate: boolean) {
    this.propAim = rotate;
    if (this.selected?.kind !== 'prop') return;
    const pose = this.getPropPose?.(this.selectedPropId!);
    if (rotate) { this.proxy.rotation.set(0, 0, pose?.yaw ?? 0); this.control.setMode('rotate'); this.control.showX = false; this.control.showY = false; this.control.showZ = true; }
    else { this.control.setMode('translate'); this.control.showX = true; this.control.showY = true; this.control.showZ = true; }
    this.control.enabled = true; this.helper.visible = true;
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
    this.snapMarker.geometry.dispose();
    (this.snapMarker.material as THREE.Material).dispose();
    this.scene.remove(this.group, this.proxy, this.snapMarker);
  }
}
