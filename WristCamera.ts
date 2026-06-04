/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';

/**
 * WristCamera — a gripper-mounted camera that tracks the arm's end-effector and renders a second
 * PIP "footage" feed, mirroring the real SO-101 wrist cam.
 *
 * Real unit (read off the Jetson via v4l2-ctl): HBVCAM USB module (0bdc:8088), MJPG up to
 * 1280×720 @ 30 fps, 16:9. The descriptor doesn't report FOV (HBVCAM modules don't), so we
 * default to a typical ~70° horizontal (≈43° vertical at 16:9) and expose it as editable.
 *
 * Unlike the placeable D435i rig, this camera has no gizmo — it rigidly follows the gripper
 * (mounted ~back behind the fingers + up, looking toward the grasp point), so its view changes
 * as the arm moves, exactly like wrist footage during a pick.
 */
export class WristCamera {
  readonly camera: THREE.PerspectiveCamera;
  enabled = false;

  // Mount offsets in the gripper frame (m) — tuned against real LeRobot wrist footage (fingers at
  // the bottom of frame, the grasp/object ahead). Tunable via the dock sliders.
  back = 0.035;  // behind the fingertips — closer = the gripper fills more of the frame (like real)
  up = 0.055;    // above the gripper centre-line (keeps the fingers at the bottom edge)
  reach = 0.05;  // how far ahead the camera aims (toward/just past the grasp point)

  private pipRenderer: THREE.WebGLRenderer | null = null;
  private pipContainer: HTMLElement | null = null;
  private readonly ly = new THREE.Vector3();
  private readonly lz = new THREE.Vector3();
  private readonly approach = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly target = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(private readonly scene: THREE.Scene) {
    // Live wrist feed is 16:9 wide (HBVCAM native), wide lens — ~58° vertical → ~90° horizontal,
    // matching the fish-eyed real FPV (gripper at the bottom, workspace filling the width).
    this.camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.01, 5);
    this.camera.up.set(0, 0, 1);
  }

  /** vertical FOV in degrees + aspect (e.g. 1280×720 → 16/9). */
  setIntrinsics(fovV: number, aspect: number) {
    this.camera.fov = fovV;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Re-pose the camera from the gripper TCP world position + its 3×3 orientation (site_xmat). */
  track(pos: THREE.Vector3, xmat: ArrayLike<number>, base = 0) {
    // MuJoCo site_xmat is row-major local→world; columns are the local axes in world coords.
    this.ly.set(xmat[base + 1], xmat[base + 4], xmat[base + 7]); // local Y (fingers extend along -localY)
    this.lz.set(xmat[base + 2], xmat[base + 5], xmat[base + 8]); // local Z (gripper "up")
    this.aim(pos);
  }

  /** Re-pose from a gripper world Matrix4 (used for static ghost arms via their TCP marker). */
  trackFromMatrix(m: THREE.Matrix4) {
    const e = m.elements; // column-major: col1 = localY, col2 = localZ, col3 = translation
    this.ly.set(e[4], e[5], e[6]);
    this.lz.set(e[8], e[9], e[10]);
    this.aim(this.p.set(e[12], e[13], e[14]));
  }

  /** Place the camera behind+above the gripper, looking toward the grasp point. */
  private aim(pos: THREE.Vector3) {
    this.approach.copy(this.ly).negate().normalize();
    this.lz.normalize();
    this.camPos.copy(pos).addScaledVector(this.approach, -this.back).addScaledVector(this.lz, this.up);
    this.target.copy(pos).addScaledVector(this.approach, this.reach);
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.lz);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }

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
    const h = container.clientHeight || Math.round(w / this.camera.aspect);
    this.pipRenderer.setSize(w, h, false);
  }

  /** Render the wrist feed (clean — hide the same overlays the main PIP hides). */
  renderPip(hideHelpers: THREE.Object3D[]) {
    if (!this.enabled || !this.pipRenderer || !this.pipContainer) return;
    this.resizePip(this.pipContainer);
    const prev = hideHelpers.map((o) => o.visible);
    hideHelpers.forEach((o) => (o.visible = false));
    this.pipRenderer.render(this.scene, this.camera);
    hideHelpers.forEach((o, i) => (o.visible = prev[i]));
  }

  dispose() { this.detachPip(); }
}
