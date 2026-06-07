/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { makeCameraGlyph, disposeGlyph } from './cameraGlyph';

/**
 * StationCamera — a fixed overhead feed for a satellite workstation (#6). It sits on the station's
 * mount post and looks straight down at that worktop's centre, rendering a PIP "what this cell's
 * overhead camera sees". Same PIP machinery as WristCamera, but a static downward pose instead of
 * tracking the gripper.
 */
export class StationCamera {
  readonly camera: THREE.PerspectiveCamera;
  /** Visible D435i-style body so the overhead camera reads as a physical camera in the scene. */
  readonly glyph = makeCameraGlyph(0.9);
  private pipRenderer: THREE.WebGLRenderer | null = null;
  private pipContainer: HTMLElement | null = null;

  constructor(private readonly scene: THREE.Scene) {
    // ~62° V, 4:3 — a generic overhead lens; the worktop's +Y reads as "up" in the image.
    this.camera = new THREE.PerspectiveCamera(62, 4 / 3, 0.05, 12);
    this.camera.up.set(0, 1, 0);
    this.glyph.visible = false;
    this.scene.add(this.glyph);
  }

  setGlyphVisible(v: boolean) { this.glyph.visible = v && !this.glyph.userData.hiddenByUser; }

  /** Mount on the post (camX,camY,camZ) looking straight down at the worktop centre (lookX,lookY,0). */
  setPose(camX: number, camY: number, camZ: number, lookX: number, lookY: number) {
    this.camera.position.set(camX, camY, camZ);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookX, lookY, 0);
    this.camera.updateMatrixWorld();
    this.glyph.position.copy(this.camera.position);
    this.glyph.quaternion.copy(this.camera.quaternion);
  }

  /** Pose by explicit euler aim (rx,ry,rz). 0,0,0 = identity = looks straight DOWN (-Z) with +Y up,
   *  matching the straight-down default; rotate to tilt/aim. Used by the placeable extra cameras. */
  setPoseEuler(camX: number, camY: number, camZ: number, rx: number, ry: number, rz: number) {
    this.camera.position.set(camX, camY, camZ);
    this.camera.rotation.set(rx, ry, rz);
    this.camera.updateMatrixWorld();
    this.glyph.position.copy(this.camera.position);
    this.glyph.quaternion.copy(this.camera.quaternion);
  }

  attachPip(container: HTMLElement) {
    if (this.pipContainer === container && this.pipRenderer) return;
    // Reuse the one renderer/GL context across attach/detach — creating a new one per attach churns
    // WebGL contexts (browsers cap them) and never frees fast enough under repeated cell switching.
    if (!this.pipRenderer) {
      this.pipRenderer = new THREE.WebGLRenderer({ antialias: true });
      this.pipRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    } else {
      this.pipRenderer.domElement.remove();
    }
    container.appendChild(this.pipRenderer.domElement);
    const c = this.pipRenderer.domElement.style; c.width = '100%'; c.height = '100%'; c.display = 'block';
    this.resizePip(container);
    this.pipContainer = container;
  }

  detachPip() {
    // Keep the renderer/context for reuse; just unmount its canvas (dispose only in dispose()).
    if (this.pipRenderer) this.pipRenderer.domElement.remove();
    this.pipContainer = null;
  }

  /** Ensure THIS camera's PIP canvas is the sole one mounted in `el` (idempotent + self-healing):
   *  strips any other camera's orphaned canvas from the host, then attaches. Used by the Compare
   *  slot effect so swapping which cell a pane frames never leaves a stolen/blank feed. */
  mountPip(el: HTMLElement) {
    el.querySelectorAll('canvas').forEach((c) => { if (c !== this.pipRenderer?.domElement) c.remove(); });
    this.attachPip(el);
  }

  private resizePip(container: HTMLElement) {
    if (!this.pipRenderer) return;
    const MAX = 1280; // clamp: a percentage-sized host can report a runaway clientHeight → OOM
    const w = Math.min(container.clientWidth || 320, MAX);
    const h = Math.min(container.clientHeight || Math.round(w / this.camera.aspect), MAX);
    if (w < 2 || h < 2) return; // host not laid out yet — don't allocate a degenerate buffer
    this.pipRenderer.setSize(w, h, false);
  }

  /** Render the station feed, hiding the same overlays the overhead D435i hides. */
  renderPip(hideHelpers: THREE.Object3D[]) {
    if (!this.pipRenderer || !this.pipContainer) return;
    this.resizePip(this.pipContainer);
    const hide = [...hideHelpers, this.glyph]; // never let the camera see its own body
    const prev = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    this.pipRenderer.render(this.scene, this.camera);
    hide.forEach((o, i) => (o.visible = prev[i]));
  }

  dispose() {
    if (this.pipRenderer) { this.pipRenderer.domElement.remove(); this.pipRenderer.dispose(); this.pipRenderer = null; }
    this.pipContainer = null;
    this.scene.remove(this.glyph); disposeGlyph(this.glyph);
  }
}
