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

  /** The camera-post mesh(es). Hidden during PIP renders so the sim "footage" matches the real
   *  D435i, which is mounted ON the post and therefore never sees it. */
  postMeshes: THREE.Object3D[] = [];
  /** World position of the camera post (top centre), for snapping the camera onto the rod. */
  readonly postTop = new THREE.Vector3();
  /** World X/Y of the post axis + its height + cross-section — exposed for snapping/selection. */
  postAxis = { x: 0, y: 0, height: 0, width: 0.024 };
  /** Rods as world line segments (the upright post + the perimeter rails) — for snap/slide.
   *  `center` = the worktop centre that rail belongs to, so edge-snap can face an arm toward the
   *  RIGHT table (matters once there are satellite workstations offset from the world origin). */
  rods: Array<{ a: THREE.Vector3; b: THREE.Vector3; label: string; center?: THREE.Vector3 }> = [];

  private readonly slabMat = new THREE.MeshStandardMaterial({ color: 0xededf2, roughness: 0.85, metalness: 0.05 });
  private readonly railMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.5, metalness: 0.6 });

  constructor(scene: THREE.Scene) {
    this.group.name = 'WorktopBase';
    scene.add(this.group);
  }

  /** Rebuild the worktop from config. Cheap — call on every slider change. */
  /** Station-local rim corners. 4-sided: a rectangle from per-side extents [right,left,front,back]
   *  (falls back to ±halfX/±halfY). N>4: a polygon with one circum-radius per corner (falls back to
   *  the halfX/halfY ellipse). Lets each rail/corner be sized independently. */
  private localRim(sides: number, halfX: number, halfY: number, sideExtents?: [number, number, number, number], cornerRadii?: number[]): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    if (sides === 4) {
      const e = sideExtents;
      const xMax = e ? Math.max(0.05, e[0]) : halfX, xMin = e ? -Math.max(0.05, e[1]) : -halfX;
      const yMax = e ? Math.max(0.05, e[2]) : halfY, yMin = e ? -Math.max(0.05, e[3]) : -halfY;
      out.push([xMin, yMin], [xMax, yMin], [xMax, yMax], [xMin, yMax]);
    } else {
      const useR = !!cornerRadii && cornerRadii.length === sides;
      for (let i = 0; i < sides; i++) {
        const a = -Math.PI / 2 + (i * Math.PI * 2) / sides;
        const rx = useR ? Math.max(0.05, cornerRadii![i]) : halfX;
        const ry = useR ? Math.max(0.05, cornerRadii![i]) : halfY;
        out.push([Math.cos(a) * rx, Math.sin(a) * ry]);
      }
    }
    return out;
  }

  rebuild(config: WorkcellConfig) {
    this.clear();
    this.postMeshes = [];

    const sides = Math.max(3, Math.min(8, Math.round(config.shapeSides)));
    const halfX = Math.max(0.175, config.length / 2);
    const halfY = Math.max(0.175, config.width / 2);
    const barW = Math.max(0.012, config.barWidth);
    const barH = Math.max(0.012, config.barHeight);
    const postH = Math.max(0.08, config.postHeight);

    // Primary-worktop placement (move/rotate the main table like a station). Identity by default,
    // so the world origin stays at 0,0 and reach/coordinate readouts are unaffected. We bake the
    // transform into the rim/post points (not a sub-group) so the `rods` world segments used for
    // snapping stay correct.
    const ox = config.originX ?? 0, oy = config.originY ?? 0, yaw = config.yaw ?? 0;
    const cyaw = Math.cos(yaw), syaw = Math.sin(yaw);
    const tf = (x: number, y: number): [number, number] => [ox + x * cyaw - y * syaw, oy + x * syaw + y * cyaw];

    // Corner points of the rim (rectangle or regular N-gon inscribed in the half-extents), in WORLD
    // coords after applying the primary placement transform.
    const rim: Array<[number, number]> = this.localRim(sides, halfX, halfY, config.sideExtents, config.cornerRadii).map(([x, y]) => tf(x, y));

    // --- Slab: extrude the rim polygon downward, top face at z=0 ---
    const shape = new THREE.Shape();
    rim.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
    shape.closePath();
    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    slabGeo.translate(0, 0, -0.02); // extrude is +Z; shift so the TOP sits at z=0
    const slab = new THREE.Mesh(slabGeo, this.slabMat);
    slab.receiveShadow = true;
    slab.userData.selectable = 'station'; slab.userData.stationId = 'primary'; // right-click the main table
    this.group.add(slab);

    // --- Perimeter rods (one box per rim edge), sitting on the slab top ---
    this.rods = [];
    for (let i = 0; i < rim.length; i++) {
      const [x1, y1] = rim[i];
      const [x2, y2] = rim[(i + 1) % rim.length];
      const span = Math.hypot(x2 - x1, y2 - y1);
      const override = config.railLengths?.[i];
      const len = override && override > 0 ? override : span; // independent bar length (need not meet corners)
      const rod = new THREE.Mesh(new THREE.BoxGeometry(len, barW, barH), this.railMat);
      rod.position.set((x1 + x2) / 2, (y1 + y2) / 2, barH / 2);
      rod.rotation.z = Math.atan2(y2 - y1, x2 - x1);
      rod.castShadow = true;
      rod.userData.selectable = 'station'; rod.userData.stationId = 'primary';
      this.group.add(rod);
      this.rods.push({ a: new THREE.Vector3(x1, y1, barH / 2), b: new THREE.Vector3(x2, y2, barH / 2), label: `Rail ${i + 1}` });
    }

    // --- Camera post (aluminium upright) at an explicit world X/Y (also placed by the transform) ---
    const [px, py] = tf(config.postX, config.postY);
    const post = new THREE.Mesh(new THREE.BoxGeometry(barW, barW, postH), this.railMat);
    post.position.set(px, py, postH / 2);
    post.castShadow = true;
    post.userData.selectable = 'post'; // pickable by the SelectionController
    this.group.add(post);
    this.postMeshes.push(post);
    this.postAxis = { x: px, y: py, height: postH, width: barW };
    this.postTop.set(px, py, postH);
    // The upright post first — it's the rod users mount the camera on / slide along.
    this.rods.unshift({ a: new THREE.Vector3(px, py, 0), b: new THREE.Vector3(px, py, postH), label: 'Post' });

    // --- Extra user-added upright posts (custom mount points) ---
    (config.extraPosts ?? []).forEach((ep, i) => {
      const h = Math.max(0.08, ep.height);
      const m = new THREE.Mesh(new THREE.BoxGeometry(barW, barW, h), this.railMat);
      m.position.set(ep.x, ep.y, h / 2);
      m.castShadow = true;
      m.userData.selectable = 'post'; m.userData.postIndex = i; // right-click → move/duplicate/delete
      this.group.add(m);
      this.postMeshes.push(m);
      this.rods.push({ a: new THREE.Vector3(ep.x, ep.y, 0), b: new THREE.Vector3(ep.x, ep.y, h), label: `Post ${i + 2}` });
    });

    // --- Decoupled props: pure Three.js cubes (no physics) — add/duplicate/delete/move live ---
    (config.props ?? []).forEach((pr) => {
      const s = Math.max(0.01, pr.size);
      const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), new THREE.MeshStandardMaterial({ color: pr.color, roughness: 0.6, metalness: 0.05 }));
      m.position.set(pr.x, pr.y, pr.z);
      m.rotation.z = pr.yaw;
      m.castShadow = true; m.receiveShadow = true;
      m.userData.selectable = 'prop'; m.userData.propId = pr.id;
      this.group.add(m);
    });

    // --- Additional workstations: each its own rectangular worktop (slab + rails + post) ---
    (config.stations ?? []).forEach((st, si) => {
      this.buildWorktop(st.x, st.y, st.yaw ?? 0, Math.max(3, Math.min(8, Math.round(st.shapeSides ?? 4))),
        Math.max(0.175, st.length / 2), Math.max(0.175, st.width / 2),
        barW, barH, { x: st.postX, y: st.postY, height: st.postHeight }, `S${si + 2} `, st.id, st.sideExtents, st.cornerRadii, st.railLengths);
    });
  }

  /** Build one rectangular worktop (slab + perimeter rails + a mount post) centred at (cx,cy).
   *  Shared by the satellite workstations; their rails carry `center` so edge-snap faces inward
   *  toward the right table. (The primary worktop is built inline above to preserve its exact
   *  post-axis / shape-N-gon behaviour.) */
  private buildWorktop(cx: number, cy: number, yaw: number, sides: number, halfX: number, halfY: number, barW: number, barH: number,
                       post: { x: number; y: number; height: number }, labelPrefix: string, stationId: string,
                       sideExtents?: [number, number, number, number], cornerRadii?: number[], railLengths?: number[]) {
    const center = new THREE.Vector3(cx, cy, 0);
    const cos = Math.cos(yaw), sin = Math.sin(yaw);
    // station-local (lx,ly) → world, rotated by yaw about the station centre.
    const toWorld = (lx: number, ly: number): [number, number] => [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    // Rim: per-side/per-corner overrides, falling back to a regular rectangle/N-gon.
    const rim = this.localRim(sides, halfX, halfY, sideExtents, cornerRadii);

    const shape = new THREE.Shape();
    rim.forEach(([x, y], i) => (i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y)));
    shape.closePath();
    const slabGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
    slabGeo.rotateZ(yaw); slabGeo.translate(cx, cy, -0.02);
    const slab = new THREE.Mesh(slabGeo, this.slabMat);
    slab.receiveShadow = true;
    slab.userData.selectable = 'station'; slab.userData.stationId = stationId;
    this.group.add(slab);

    for (let i = 0; i < rim.length; i++) {
      const [x1, y1] = rim[i];
      const [x2, y2] = rim[(i + 1) % rim.length];
      const span = Math.hypot(x2 - x1, y2 - y1);
      const override = railLengths?.[i];
      const len = override && override > 0 ? override : span;
      const rod = new THREE.Mesh(new THREE.BoxGeometry(len, barW, barH), this.railMat);
      const [mwx, mwy] = toWorld((x1 + x2) / 2, (y1 + y2) / 2);
      rod.position.set(mwx, mwy, barH / 2);
      rod.rotation.z = Math.atan2(y2 - y1, x2 - x1) + yaw;
      rod.castShadow = true;
      rod.userData.selectable = 'station'; rod.userData.stationId = stationId;
      this.group.add(rod);
      const [ax, ay] = toWorld(x1, y1); const [bx, by] = toWorld(x2, y2);
      this.rods.push({ a: new THREE.Vector3(ax, ay, barH / 2), b: new THREE.Vector3(bx, by, barH / 2), label: `${labelPrefix}Rail ${i + 1}`, center });
    }

    const h = Math.max(0.08, post.height);
    const m = new THREE.Mesh(new THREE.BoxGeometry(barW, barW, h), this.railMat);
    const [pwx, pwy] = toWorld(post.x, post.y);
    m.position.set(pwx, pwy, h / 2);
    m.castShadow = true;
    m.userData.selectable = 'station'; m.userData.stationId = stationId; // station post selects the station
    this.group.add(m);
    this.postMeshes.push(m);
    this.rods.push({ a: new THREE.Vector3(pwx, pwy, 0), b: new THREE.Vector3(pwx, pwy, h), label: `${labelPrefix}Post`, center });
  }

  private clear() {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry?.dispose();
      // slabMat/railMat are shared + reused; per-prop materials are one-off → dispose to avoid a leak.
      const mat = mesh.material as THREE.Material | undefined;
      if (mat && mat !== this.slabMat && mat !== this.railMat) mat.dispose();
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
