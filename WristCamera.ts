/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { makeCameraGlyph, disposeGlyph } from './cameraGlyph';

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

  // ── RIGID mount, defined entirely in the gripper's LOCAL frame (the TCP site is rigidly fixed in
  // the Fixed_Jaw body, so its frame IS the gripper frame). The mount is a CONSTANT local offset +
  // a tilt — NOT derived from the fingertip position or by guessing which world-axis is "up". This
  // is pose-invariant: wrist-roll/pitch/base all just carry the camera rigidly, so it can't regress.
  //   local axes (probed): -localY = toward the fingertips (down the gripper); +localY = up toward
  //   the wrist; localZ = the gripper's facing direction; localX = sideways.
  //   The TCP (origin of this frame) is at the FINGERTIPS; the gripper centre is ~+0.05 up localY.
  // Defaults pin the lens at the gripper centre looking down the fingers, slightly tilted forward.
  posX = 0;       // sideways offset (localX)
  posY = 0.14;    // up the gripper centreline, clear of the servo/jaws (body origin is +0.10); looks down
  posZ = 0.02;    // toward the gripper's facing side (localZ)
  tiltDeg = 25;   // 0-360°: 0 = look straight down the fingers; rises toward "forward" then around

  /** Visible camera-body glyph pinned on the gripper (small, so it doesn't clutter the gripper). */
  readonly glyph = makeCameraGlyph(0.35);
  private pipRenderer: THREE.WebGLRenderer | null = null;
  private pipContainer: HTMLElement | null = null;
  private readonly lx = new THREE.Vector3();
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
    this.glyph.visible = false;
    this.scene.add(this.glyph);
  }

  setGlyphVisible(v: boolean) { this.glyph.visible = v; }

  /** vertical FOV in degrees + aspect (e.g. 1280×720 → 16/9). */
  setIntrinsics(fovV: number, aspect: number) {
    this.camera.fov = fovV;
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Re-pose the camera from the gripper TCP world position + its 3×3 orientation (site_xmat). */
  track(pos: THREE.Vector3, xmat: ArrayLike<number>, base = 0) {
    // MuJoCo site_xmat is row-major local→world; columns are the local axes in world coords.
    this.lx.set(xmat[base + 0], xmat[base + 3], xmat[base + 6]);  // local X (sideways)
    this.ly.set(xmat[base + 1], xmat[base + 4], xmat[base + 7]);  // local Y (-localY = toward fingertips)
    this.lz.set(xmat[base + 2], xmat[base + 5], xmat[base + 8]);  // local Z (gripper facing)
    this.aim(pos);
  }

  /** Re-pose from a gripper world Matrix4 (used for static ghost arms via their TCP marker). */
  trackFromMatrix(m: THREE.Matrix4) {
    const e = m.elements; // column-major: col0 = localX, col1 = localY, col2 = localZ, col3 = translation
    this.lx.set(e[0], e[1], e[2]);
    this.ly.set(e[4], e[5], e[6]);
    this.lz.set(e[8], e[9], e[10]);
    this.aim(this.p.set(e[12], e[13], e[14]));
  }

  /** Rigid mount: place the lens at a CONSTANT local offset (posX/Y/Z) in the gripper frame and
   *  look down the fingers (-localY), tilted by `tiltDeg` toward the gripper's facing (+localZ). The
   *  offset & look are constant local vectors carried by the gripper's own orientation — pose-
   *  invariant, so wrist roll/pitch/base motion just move the camera rigidly with the gripper. */
  private aim(pos: THREE.Vector3) {
    this.lx.normalize(); this.ly.normalize(); this.lz.normalize();
    const t = (this.tiltDeg * Math.PI) / 180;
    // optical axis in local: -localY (down the fingers) swept toward +localZ by tiltDeg.
    this.fwd.copy(this.ly).multiplyScalar(-Math.cos(t)).addScaledVector(this.lz, Math.sin(t)).normalize();
    this.camUp.copy(this.lz); // image up = the gripper facing side
    // lens position = TCP + a fixed offset in the gripper's own frame.
    this.camPos.copy(pos).addScaledVector(this.lx, this.posX).addScaledVector(this.ly, this.posY).addScaledVector(this.lz, this.posZ);
    this.target.copy(this.camPos).addScaledVector(this.fwd, 0.3);
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
    this.glyph.position.copy(this.camera.position);
    this.glyph.quaternion.copy(this.camera.quaternion);
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

  /** Render the wrist feed (clean — hide the same overlays the main PIP hides + its OWN glyph). */
  renderPip(hideHelpers: THREE.Object3D[]) {
    if (!this.enabled || !this.pipRenderer || !this.pipContainer) return;
    this.resizePip(this.pipContainer);
    const hide = [...hideHelpers, this.glyph];
    const prev = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.pipRenderer.render(this.scene, this.camera);
    hide.forEach((o, i) => (o.visible = prev[i]));
  }

  dispose() { this.detachPip(); this.scene.remove(this.glyph); disposeGlyph(this.glyph); }
}
