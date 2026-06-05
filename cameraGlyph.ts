/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';

/**
 * A small D435i-style camera body glyph (dark bar + amber "lens" cone) whose local -Z is the
 * optical/look axis — so it can be posed by copying a THREE camera's position+quaternion. Shared by
 * the wrist cam and the extra/overhead cameras so they READ as physical cameras in the 3D view,
 * matching how the primary D435i gizmo appears.
 */
export function makeCameraGlyph(scale = 1): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.08 * scale, 0.05 * scale, 0.05 * scale),
    new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.5, metalness: 0.3 }),
  );
  const lens = new THREE.Mesh(
    new THREE.ConeGeometry(0.022 * scale, 0.045 * scale, 20),
    new THREE.MeshStandardMaterial({ color: 0xe0a530, emissive: 0x3d2a00, roughness: 0.4 }),
  );
  lens.geometry.rotateX(-Math.PI / 2); // cone apex -> -Z (the camera look direction)
  lens.position.set(0, 0, -0.04 * scale);
  g.add(body, lens);
  g.renderOrder = 1;
  return g;
}

export function disposeGlyph(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); }
  });
}
