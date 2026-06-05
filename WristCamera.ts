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
  /** Which arm this feed is mounted on (primary or a planning ghost). '' = legacy/selected. */
  armId = '';

  // Rigid mount in the GRIPPER's local frame (probed: localY≈up so -localY=down toward the
  // fingertips; localZ≈the table-facing/forward direction; localX is sideways and must NOT be used).
  // The real bracket sits above the wrist and tilts the lens forward at the table, so the gripper
  // fingers sit at the BOTTOM of the frame and the workspace fills the top — matching real FPV.
  back = 0.035;  // shift the mount back toward the wrist (along -localZ)
  up = 0.06;     // raise the mount above the wrist (along +localY) — the bracket height
  reach = 0.10;  // how far ahead along the optical axis the camera aims
  tiltDeg = 38;  // forward tilt of the optical axis from straight-down (0 = straight down past fingers)

  private pipRenderer: THREE.WebGLRenderer | null = null;
  private pipContainer: HTMLElement | null = null;
  private readonly ly = new THREE.Vector3();
  private readonly lz = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly camUp = new THREE.Vector3();
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
    this.ly.set(xmat[base + 1], xmat[base + 4], xmat[base + 7]);  // local Y: fingers extend along -localY (down)
    this.lz.set(xmat[base + 2], xmat[base + 5], xmat[base + 8]);  // local Z: the table-facing/forward direction
    this.aim(pos);
  }

  /** Re-pose from a gripper world Matrix4 (used for static ghost arms via their TCP marker). */
  trackFromMatrix(m: THREE.Matrix4) {
    const e = m.elements; // column-major: col1 = localY, col2 = localZ, col3 = translation
    this.ly.set(e[4], e[5], e[6]);
    this.lz.set(e[8], e[9], e[10]);
    this.aim(this.p.set(e[12], e[13], e[14]));
  }

  /** Rigid wrist mount: above the gripper looking DOWN past the fingertips, tilted forward at the
   *  workspace so the fingers sit at the bottom of the frame and the table fills the top — the real
   *  HBVCAM FPV. All in the gripper's local frame so it stays correct as the arm moves. */
  private aim(pos: THREE.Vector3) {
    this.ly.normalize();
    this.lz.normalize();
    const t = (this.tiltDeg * Math.PI) / 180;
    // optical axis: straight down (-localY) tilted FORWARD toward the table (+localZ) by tiltDeg.
    this.fwd.copy(this.ly).multiplyScalar(-Math.cos(t)).addScaledVector(this.lz, Math.sin(t)).normalize();
    // image up = the table/forward direction, so "ahead" is at the top and the fingers fall to the bottom.
    this.camUp.copy(this.lz);
    // mount: raise above the wrist (+localY) and shift back toward the wrist (-localZ) — the bracket.
    this.camPos.copy(pos).addScaledVector(this.ly, this.up).addScaledVector(this.lz, -this.back);
    this.target.copy(this.camPos).addScaledVector(this.fwd, this.reach + 0.25);
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
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
