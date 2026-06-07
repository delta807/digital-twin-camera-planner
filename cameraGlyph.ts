/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

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

/**
 * The REAL Intel D435i body (public/d435i.stl), same mesh the primary overhead rig uses — so every
 * overhead camera (primary, station, extra) reads identically (DRY). Returns immediately with the
 * box+cone placeholder and swaps in the STL when it loads; re-applies the group's selection userData
 * to the loaded mesh so it stays click-selectable. Local -Z is the optical axis (pose by copying a
 * camera's position+quaternion).
 */
export function makeD435iGlyph(scale = 1): THREE.Group {
  const g = makeCameraGlyph(scale); // placeholder until the STL arrives
  new STLLoader().load('/d435i.stl', (geo) => {
    geo.computeBoundingBox();
    const bb = geo.boundingBox!; const size = new THREE.Vector3(); bb.getSize(size);
    const center = new THREE.Vector3(); bb.getCenter(center);
    geo.translate(-center.x, -center.y, -center.z);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x23272e, roughness: 0.45, metalness: 0.5 }));
    mesh.scale.setScalar((0.09 * scale) / Math.max(size.x, size.y, size.z)); // ≈ real D435i width
    mesh.rotation.x = -Math.PI / 2; // Blender +Y front → -Z optical axis
    g.clear(); // drop the placeholder box+cone
    g.add(mesh);
    // Re-tag for selection (ensureStation/ExtraCamera tagged the placeholder children, not this mesh).
    g.traverse((o) => { if (g.userData.selectable) { o.userData.selectable = g.userData.selectable; o.userData.cameraId = g.userData.cameraId; } });
  }, undefined, () => { /* keep the placeholder on load failure */ });
  return g;
}

export function disposeGlyph(g: THREE.Group): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) { m.geometry?.dispose(); (m.material as THREE.Material)?.dispose(); }
  });
}
