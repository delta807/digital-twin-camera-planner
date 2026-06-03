/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { WorkcellConfig } from './types';

/**
 * BaseBuilder
 *
 * Renders the worktop (slab + perimeter aluminium-extrusion rods + camera post) as pure
 * Three.js geometry generated from a `WorkcellConfig`. Because the arm sits on the floor at
 * z=0 and the task objects are static, the table needs no physics — so making it visual-only
 * means size / rod-length / rod-thickness / height / shape edits are **live with no MuJoCo
 * reload** (the thing that made "edit the rods" feel inert before). Worktop top stays at z=0.
 */
export class BaseBuilder {
  readonly group = new THREE.Group();

  private readonly slabMat = new THREE.MeshStandardMaterial({ color: 0xededf2, roughness: 0.85, metalness: 0.05 });
  private readonly railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 });

  constructor(scene: THREE.Scene) {
    this.group.name = 'WorktopBase';
    scene.add(this.group);
  }

  /** Rebuild the worktop from config. Cheap — call on every slider change. */
  rebuild(config: WorkcellConfig) {
    this.clear();

    const sides = Math.max(3, Math.min(8, Math.round(config.shapeSides)));
    const halfX = Math.max(0.175, config.length / 2);
    const halfY = Math.max(0.175, config.width / 2);
    const barW = Math.max(0.012, config.barWidth);
    const barH = Math.max(0.012, config.barHeight);
    const postH = Math.max(0.08, config.postHeight);

    // Corner points of the rim (rectangle or regular N-gon inscribed in the half-extents).
    const rim: Array<[number, number]> = [];
    if (sides === 4) {
      rim.push([-halfX, -halfY], [halfX, -halfY], [halfX, halfY], [-halfX, halfY]);
    } else {
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
        rim.push([Math.cos(a) * halfX, Math.sin(a) * halfY]);
      }
    }

    // --- Slab: extrude the rim polygon downward, top face at z=0 ---
    const shape = new THREE.Shape();
    rim.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
    shape.closePath();
    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    slabGeo.translate(0, 0, -0.02); // extrude is +Z; shift so the TOP sits at z=0
    const slab = new THREE.Mesh(slabGeo, this.slabMat);
    slab.receiveShadow = true;
    this.group.add(slab);

    // --- Perimeter rods (one box per rim edge), sitting on the slab top ---
    for (let i = 0; i < rim.length; i++) {
      const [x1, y1] = rim[i];
      const [x2, y2] = rim[(i + 1) % rim.length];
      const len = Math.hypot(x2 - x1, y2 - y1);
      const rod = new THREE.Mesh(new THREE.BoxGeometry(len, barW, barH), this.railMat);
      rod.position.set((x1 + x2) / 2, (y1 + y2) / 2, barH / 2);
      rod.rotation.z = Math.atan2(y2 - y1, x2 - x1);
      rod.castShadow = true;
      this.group.add(rod);
    }

    // --- Camera post at a corner ---
    const post = new THREE.Mesh(new THREE.BoxGeometry(barW, barW, postH), this.railMat);
    post.position.set(halfX - 0.02, -halfY + 0.02, postH / 2);
    post.castShadow = true;
    this.group.add(post);
  }

  private clear() {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose(); // materials are shared + reused, don't dispose them
      this.group.remove(mesh);
    }
  }

  dispose() {
    this.clear();
    this.slabMat.dispose();
    this.railMat.dispose();
    this.group.removeFromParent();
  }
}
