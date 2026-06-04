/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { isPointVisibleFromSensor } from './coverage';
import {
  CameraIntrinsics,
  CameraViewToggles,
  D435I_PRESET,
  DEFAULT_CAMERA_TOGGLES,
} from './types';

/**
 * WorkspaceCameraRig
 *
 * A robot-agnostic, draggable "sensor camera" you can place anywhere in the scene to
 * plan a real camera's mounting. It provides four toggleable views of the same camera:
 *   • frustum   — the FOV pyramid (what the camera is aimed at)
 *   • sensorPip — a live render from the camera's POV (what the footage looks like)
 *   • footprint — the ground patch the FOV covers (frustum ∩ floor)
 *   • objectTint / coverage — what the camera can actually SEE (incl. occlusion)
 *
 * It is fully self-contained: RenderSystem creates one, calls update() each frame, and
 * passes it the scene root used for occlusion + a few decorative helpers to hide from
 * the PIP. Nothing else in the sim needs to know about it.
 */
export class WorkspaceCameraRig {
  readonly sensorCamera: THREE.PerspectiveCamera;

  /** The grab handle whose pose drives the sensor camera. Drag it with TransformControls. */
  readonly gizmo = new THREE.Group(); // public so the SelectionController can raycast it
  private readonly control: TransformControls;
  private readonly controlHelper: THREE.Object3D;

  private readonly frustumLines: THREE.LineSegments;
  private readonly footprint: THREE.Mesh;
  private coveragePoints: THREE.Points | null = null;

  /** Overlays that must be hidden when rendering the camera's own POV. */
  private readonly ownHelpers: THREE.Object3D[];

  private intrinsics: CameraIntrinsics = { ...D435I_PRESET };
  private toggles: CameraViewToggles = { ...DEFAULT_CAMERA_TOGGLES };

  // PIP render target (lazy: only renders once a DOM container is attached).
  private pipRenderer: THREE.WebGLRenderer | null = null;
  private pipContainer: HTMLElement | null = null;

  // Reused scratch objects (avoid per-frame allocation).
  private readonly raycaster = new THREE.Raycaster();
  private readonly frustum = new THREE.Frustum();
  private readonly projScratch = new THREE.Matrix4();
  private readonly tinted: THREE.MeshStandardMaterial[] = [];

  // Hook fired when the user finishes dragging (so coverage can recompute on demand).
  onDragEnd: (() => void) | null = null;

  constructor(
    private readonly scene: THREE.Scene,
    mainCamera: THREE.Camera,
    domElement: HTMLElement,
    orbitControls: OrbitControls,
  ) {
    // --- Sensor camera (z-up to match the world) ---
    this.sensorCamera = new THREE.PerspectiveCamera(42, this.intrinsics.aspect, 0.05, 100);
    this.sensorCamera.up.set(0, 0, 1);
    this.applyIntrinsicsToCamera();

    // --- Grab gizmo: a little camera body + a "lens" cone pointing down its -Z view axis ---
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.05, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.3 }),
    );
    const lens = new THREE.Mesh(
      new THREE.ConeGeometry(0.025, 0.05, 20),
      new THREE.MeshStandardMaterial({ color: 0x4f46e5, emissive: 0x312e81, roughness: 0.4 }),
    );
    lens.geometry.rotateX(-Math.PI / 2); // cone apex -> -Z (the camera look direction)
    lens.position.set(0, 0, -0.04);
    this.gizmo.add(body, lens);
    this.gizmo.userData.selectable = 'camera'; // pickable by the SelectionController
    body.userData.selectable = 'camera';
    lens.userData.selectable = 'camera';
    this.scene.add(this.gizmo);
    this.loadCameraMesh(body, lens); // swap the placeholder for the real D435i mesh once loaded

    // Sensible starting pose: mounted above the worktop, looking straight DOWN (top-down view,
    // like the real rig's overhead D435i). User can reposition / re-aim from here.
    this.setPose(new THREE.Vector3(0.15, -0.15, 0.7), new THREE.Vector3(0.15, -0.15, 0));

    // --- Drag handle (reuses the project's TransformControls pattern; getHelper() is the
    //     correct API in three 0.181 where TransformControls no longer extends Object3D) ---
    this.control = new TransformControls(mainCamera, domElement);
    this.control.setSpace('world');
    this.control.addEventListener('dragging-changed', (e) => {
      const dragging = (e as unknown as { value: boolean }).value;
      orbitControls.enabled = !dragging;
      if (!dragging && this.onDragEnd) this.onDragEnd();
    });
    this.control.attach(this.gizmo);
    this.controlHelper = this.control.getHelper();
    this.scene.add(this.controlHelper);

    // --- Frustum wireframe (12 edges = 24 vertices, positions rewritten each frame) ---
    const frustumGeo = new THREE.BufferGeometry();
    frustumGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.frustumLines = new THREE.LineSegments(
      frustumGeo,
      new THREE.LineBasicMaterial({ color: 0x4f46e5, transparent: true, opacity: 0.9 }),
    );
    this.frustumLines.frustumCulled = false;
    this.scene.add(this.frustumLines);

    // --- Ground footprint quad ---
    const fpGeo = new THREE.BufferGeometry();
    fpGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    fpGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.footprint = new THREE.Mesh(
      fpGeo,
      new THREE.MeshBasicMaterial({
        color: 0x4f46e5,
        transparent: true,
        opacity: 0.18,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.footprint.frustumCulled = false;
    this.scene.add(this.footprint);

    this.ownHelpers = [this.gizmo, this.controlHelper, this.frustumLines, this.footprint];
    this.applyToggleVisibility();
  }

  // ───────────────────────── public API ─────────────────────────

  setEnabled(enabled: boolean) {
    this.toggles.enabled = enabled;
    this.applyToggleVisibility();
  }

  setToggles(t: Partial<CameraViewToggles>) {
    this.toggles = { ...this.toggles, ...t };
    this.applyToggleVisibility();
  }

  setIntrinsics(i: Partial<CameraIntrinsics>) {
    this.intrinsics = { ...this.intrinsics, ...i };
    this.applyIntrinsicsToCamera();
  }

  resetIntrinsics() {
    this.setIntrinsics({ ...D435I_PRESET });
  }

  getIntrinsics(): CameraIntrinsics {
    return { ...this.intrinsics };
  }

  /** 'translate' to move the camera, 'rotate' to aim it. */
  setDragMode(mode: 'translate' | 'rotate') {
    this.control.setMode(mode);
  }

  /** Place the camera at `pos` looking at `target` (world space, z-up). */
  setPose(pos: THREE.Vector3, target: THREE.Vector3) {
    this.gizmo.position.copy(pos);
    const m = new THREE.Matrix4().lookAt(pos, target, new THREE.Vector3(0, 0, 1));
    this.gizmo.quaternion.setFromRotationMatrix(m);
  }

  /** Move the camera to an exact world position, keeping its current aim. */
  setPosition(x: number, y: number, z: number) {
    this.gizmo.position.set(x, y, z);
  }

  /** Aim the camera straight down (optical axis = world -Z) from its current position. */
  aimDown() {
    const p = this.gizmo.position;
    this.setPose(p.clone(), new THREE.Vector3(p.x, p.y, p.z - 1));
  }

  getPosition(): THREE.Vector3 {
    return this.gizmo.position.clone();
  }

  /** Replace the placeholder box gizmo with the real Intel D435i mesh (public/d435i.stl). */
  private loadCameraMesh(...fallback: THREE.Object3D[]) {
    new STLLoader().load('/d435i.stl', (geo) => {
      geo.computeBoundingBox();
      const bb = geo.boundingBox!;
      const size = new THREE.Vector3(); bb.getSize(size);
      const center = new THREE.Vector3(); bb.getCenter(center);
      geo.translate(-center.x, -center.y, -center.z);          // center on the gizmo origin
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.45, metalness: 0.5 }));
      // Scale so the longest dimension ≈ the real D435i width (~90 mm).
      mesh.scale.setScalar(0.09 / Math.max(size.x, size.y, size.z));
      // Orient so the camera's optical axis (gizmo -Z) points out the lens. The Blender export's
      // "front" is +Y, so rotate +X by -90° to map +Y → -Z; tweak if the lens faces the wrong way.
      mesh.rotation.x = -Math.PI / 2;
      mesh.userData.selectable = 'camera';
      this.gizmo.add(mesh);
      fallback.forEach((o) => (o.visible = false));
    }, undefined, () => { /* keep the placeholder box on load failure */ });
  }

  /** Attach the PIP render to a DOM container (16:9 recommended). Lazy: no-op until called. */
  attachPip(container: HTMLElement) {
    if (this.pipContainer === container && this.pipRenderer) return;
    this.detachPip();
    this.pipRenderer = new THREE.WebGLRenderer({ antialias: true });
    this.pipRenderer.setPixelRatio(window.devicePixelRatio);
    this.resizePip(container);
    container.appendChild(this.pipRenderer.domElement);
    this.pipContainer = container;
  }

  detachPip() {
    if (this.pipRenderer) {
      this.pipRenderer.domElement.remove();
      this.pipRenderer.dispose();
      this.pipRenderer = null;
    }
    this.pipContainer = null;
  }

  private resizePip(container: HTMLElement) {
    if (!this.pipRenderer) return;
    const w = container.clientWidth || 320;
    const h = container.clientHeight || Math.round(w / this.intrinsics.aspect);
    this.pipRenderer.setSize(w, h, false);
  }

  /**
   * Per-frame update. Call AFTER bodies have been posed and the main view rendered.
   * @param occluderRoot the scene subtree used for occlusion + in-frustum tinting (simGroup)
   * @param externalHelpers extra decorative objects to hide from the PIP (grid, ER markers…)
   */
  update(occluderRoot: THREE.Object3D, externalHelpers: THREE.Object3D[]) {
    this.syncSensorToGizmo();

    if (this.toggles.enabled && this.toggles.frustum) this.updateFrustumLines();
    if (this.toggles.enabled && this.toggles.footprint) this.updateFootprint();
    if (this.toggles.enabled && this.toggles.objectTint) this.applyTint(occluderRoot);
    else this.clearTint();

    if (this.toggles.enabled && this.toggles.sensorPip) this.renderPip(externalHelpers);
  }

  /** Occlusion-aware coverage over a grid on the workspace plane. Run on demand / drag-end. */
  computeCoverage(occluderRoot: THREE.Object3D, opts?: { half?: number; step?: number; z?: number }) {
    const half = opts?.half ?? 0.7;
    const step = opts?.step ?? 0.07;
    const z = opts?.z ?? 0.02;

    this.syncSensorToGizmo();
    const occluders = this.collectMeshes(occluderRoot);

    const positions: number[] = [];
    const colors: number[] = [];
    const p = new THREE.Vector3();
    for (let x = -half; x <= half + 1e-6; x += step) {
      for (let y = -half; y <= half + 1e-6; y += step) {
        p.set(x, y, z);
        const visible = isPointVisibleFromSensor(p, this.sensorCamera, this.raycaster, occluders);
        positions.push(x, y, z);
        if (visible) colors.push(0.18, 0.83, 0.45); // green
        else colors.push(0.94, 0.27, 0.27); // red
      }
    }

    if (!this.coveragePoints) {
      const geo = new THREE.BufferGeometry();
      this.coveragePoints = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size: 0.025, vertexColors: true, sizeAttenuation: true }),
      );
      this.coveragePoints.frustumCulled = false;
      this.scene.add(this.coveragePoints);
      this.ownHelpers.push(this.coveragePoints);
    }
    // Reuse the existing buffers when the grid size is unchanged (the usual case) so repeated
    // recomputes don't orphan GPU buffers; only re-allocate if the point count actually changed.
    const geo = this.coveragePoints.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (posAttr && posAttr.array.length === positions.length) {
      (posAttr.array as Float32Array).set(positions); posAttr.needsUpdate = true;
      const colAttr = geo.getAttribute('color') as THREE.BufferAttribute;
      (colAttr.array as Float32Array).set(colors); colAttr.needsUpdate = true;
    } else {
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
    }
    this.coveragePoints.visible = this.toggles.enabled && this.toggles.coverage;
  }

  dispose() {
    this.detachPip();
    this.clearTint();
    this.control.detach();
    this.control.dispose();
    this.scene.remove(this.gizmo, this.controlHelper, this.frustumLines, this.footprint);
    if (this.coveragePoints) this.scene.remove(this.coveragePoints);
  }

  // ───────────────────────── internals ─────────────────────────

  private applyIntrinsicsToCamera() {
    const { hFovDeg, aspect, near, far } = this.intrinsics;
    // PerspectiveCamera.fov is VERTICAL; derive it from the horizontal FOV + aspect.
    const hHalf = THREE.MathUtils.degToRad(hFovDeg) / 2;
    const vHalf = Math.atan(Math.tan(hHalf) / aspect);
    this.sensorCamera.fov = THREE.MathUtils.radToDeg(vHalf * 2);
    this.sensorCamera.aspect = aspect;
    this.sensorCamera.near = near;
    this.sensorCamera.far = far;
    this.sensorCamera.updateProjectionMatrix();
  }

  private syncSensorToGizmo() {
    this.gizmo.updateMatrixWorld(true);
    this.gizmo.getWorldPosition(this.sensorCamera.position);
    this.gizmo.getWorldQuaternion(this.sensorCamera.quaternion);
    this.sensorCamera.updateMatrixWorld(true);
  }

  /** 8 world-space frustum corners: indices 0-3 near (BL,BR,TR,TL), 4-7 far. */
  private frustumCorners(): THREE.Vector3[] {
    const ndc: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const corners: THREE.Vector3[] = [];
    for (const z of [-1, 1]) {
      for (const [x, y] of ndc) {
        corners.push(new THREE.Vector3(x, y, z).unproject(this.sensorCamera));
      }
    }
    return corners;
  }

  private updateFrustumLines() {
    const c = this.frustumCorners();
    const edges = [
      0, 1, 1, 2, 2, 3, 3, 0, // near quad
      4, 5, 5, 6, 6, 7, 7, 4, // far quad
      0, 4, 1, 5, 2, 6, 3, 7, // connectors
    ];
    const attr = this.frustumLines.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < edges.length; i++) {
      const v = c[edges[i]];
      attr.setXYZ(i, v.x, v.y, v.z);
    }
    attr.needsUpdate = true;
  }

  private updateFootprint() {
    // Cast camera-origin rays through the 4 far corners; intersect each with the z=0 plane.
    const corners = this.frustumCorners();
    const origin = this.sensorCamera.position;
    const attr = this.footprint.geometry.getAttribute('position') as THREE.BufferAttribute;
    let valid = true;
    for (let i = 0; i < 4; i++) {
      const dir = corners[4 + i].clone().sub(origin); // far corner i
      if (dir.z >= -1e-4) { valid = false; break; } // ray not aimed at the ground
      const t = -origin.z / dir.z;
      const hit = origin.clone().add(dir.multiplyScalar(t));
      attr.setXYZ(i, hit.x, hit.y, 0.003);
    }
    attr.needsUpdate = true;
    this.footprint.visible = valid && this.toggles.enabled && this.toggles.footprint;
  }

  private collectMeshes(root: THREE.Object3D): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.visible && m.geometry && !(o as { isInstancedMesh?: boolean }).isInstancedMesh) {
        out.push(m);
      }
    });
    return out;
  }

  private applyTint(occluderRoot: THREE.Object3D) {
    this.clearTint();
    this.projScratch.multiplyMatrices(
      this.sensorCamera.projectionMatrix,
      this.sensorCamera.matrixWorldInverse,
    );
    this.frustum.setFromProjectionMatrix(this.projScratch);
    for (const mesh of this.collectMeshes(occluderRoot)) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      const r = mesh.geometry.boundingSphere?.radius ?? 0;
      if (r > 1.0) continue; // skip the floor / large static surfaces
      if (!this.frustum.intersectsObject(mesh)) continue;
      const mat = mesh.material as THREE.MeshStandardMaterial;
      if (!mat || !mat.emissive) continue;
      mat.userData.__prevEmissive = mat.emissive.getHex();
      mat.userData.__prevEmissiveIntensity = mat.emissiveIntensity;
      mat.emissive.setHex(0x16a34a);
      mat.emissiveIntensity = 0.6;
      this.tinted.push(mat);
    }
  }

  private clearTint() {
    for (const mat of this.tinted) {
      if (mat.userData.__prevEmissive !== undefined) {
        mat.emissive.setHex(mat.userData.__prevEmissive);
        mat.emissiveIntensity = mat.userData.__prevEmissiveIntensity ?? 1; // restore, not leave at 0.6
        delete mat.userData.__prevEmissive;
        delete mat.userData.__prevEmissiveIntensity;
      }
    }
    this.tinted.length = 0;
  }

  private renderPip(externalHelpers: THREE.Object3D[]) {
    if (!this.pipRenderer || !this.pipContainer) return;
    this.resizePip(this.pipContainer);

    // Hide every overlay/helper so the PIP shows clean "footage", not the rig itself.
    const hidden = [...this.ownHelpers, ...externalHelpers];
    const prev = hidden.map((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));

    this.pipRenderer.render(this.scene, this.sensorCamera);

    hidden.forEach((o, i) => (o.visible = prev[i]));
  }

  private applyToggleVisibility() {
    const on = this.toggles.enabled;
    this.gizmo.visible = on;
    this.controlHelper.visible = on;
    this.control.enabled = on;
    this.frustumLines.visible = on && this.toggles.frustum;
    this.footprint.visible = on && this.toggles.footprint;
    if (this.coveragePoints) this.coveragePoints.visible = on && this.toggles.coverage;
  }
}
