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

  setGlyphVisible(v: boolean) { this.glyph.visible = v; }

  /** Mount on the post (camX,camY,camZ) looking straight down at the worktop centre (lookX,lookY,0). */
  setPose(camX: number, camY: number, camZ: number, lookX: number, lookY: number) {
    this.camera.position.set(camX, camY, camZ);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(lookX, lookY, 0);
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

  dispose() { this.detachPip(); this.scene.remove(this.glyph); disposeGlyph(this.glyph); }
}
