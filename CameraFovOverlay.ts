/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';

/**
 * CameraFovOverlay — the FOV pyramid (frustum wireframe) + the ground patch it covers (footprint),
 * for any PerspectiveCamera. Extracted from WorkspaceCameraRig so every overhead D435i (primary,
 * station, extra) can show the same overlays (DRY). Add to a scene, call update() each frame.
 */
export class CameraFovOverlay {
  readonly frustumLines: THREE.LineSegments;
  readonly footprint: THREE.Mesh;

  constructor(private readonly scene: THREE.Scene) {
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(24 * 3), 3));
    this.frustumLines = new THREE.LineSegments(fg, new THREE.LineBasicMaterial({ color: 0xe0a530, transparent: true, opacity: 0.9 }));
    this.frustumLines.frustumCulled = false; this.frustumLines.visible = false;
    scene.add(this.frustumLines);

    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(4 * 3), 3));
    pg.setIndex([0, 1, 2, 0, 2, 3]);
    this.footprint = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ color: 0xe0a530, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
    this.footprint.frustumCulled = false; this.footprint.visible = false;
    scene.add(this.footprint);
  }

  /** The overlay meshes — so a PIP render can hide them (a camera shouldn't see FOV lines). */
  get objects(): THREE.Object3D[] { return [this.frustumLines, this.footprint]; }

  update(camera: THREE.PerspectiveCamera, showFrustum: boolean, showFootprint: boolean) {
    if (!showFrustum && !showFootprint) { this.frustumLines.visible = false; this.footprint.visible = false; return; }
    camera.updateMatrixWorld(); camera.updateProjectionMatrix();
    // 8 world-space frustum corners (0-3 near BL,BR,TR,TL; 4-7 far).
    const ndc: Array<[number, number]> = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    const c: THREE.Vector3[] = [];
    for (const z of [-1, 1]) for (const [x, y] of ndc) c.push(new THREE.Vector3(x, y, z).unproject(camera));

    if (showFrustum) {
      const edges = [0, 1, 1, 2, 2, 3, 3, 0, 4, 5, 5, 6, 6, 7, 7, 4, 0, 4, 1, 5, 2, 6, 3, 7];
      const attr = this.frustumLines.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < edges.length; i++) { const v = c[edges[i]]; attr.setXYZ(i, v.x, v.y, v.z); }
      attr.needsUpdate = true; this.frustumLines.visible = true;
    } else this.frustumLines.visible = false;

    if (showFootprint) {
      const o = camera.position; const attr = this.footprint.geometry.getAttribute('position') as THREE.BufferAttribute; let ok = true;
      for (let i = 0; i < 4; i++) { const dir = c[4 + i].clone().sub(o); if (dir.z >= -1e-4) { ok = false; break; } const t = -o.z / dir.z; const hit = o.clone().add(dir.multiplyScalar(t)); attr.setXYZ(i, hit.x, hit.y, 0.003); }
      attr.needsUpdate = true; this.footprint.visible = ok;
    } else this.footprint.visible = false;
  }

  dispose() {
    this.scene.remove(this.frustumLines, this.footprint);
    this.frustumLines.geometry.dispose(); (this.frustumLines.material as THREE.Material).dispose();
    this.footprint.geometry.dispose(); (this.footprint.material as THREE.Material).dispose();
  }
}
