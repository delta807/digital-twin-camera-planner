/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
// Vendored URDF-agnostic drag engine (gkjohnson/urdf-loaders) — see vendor/URDFDragControls.js.
// It only reads joint.axis / joint.matrixWorld / joint.angle and calls updateJoint(); we make our
// MuJoCo body-groups quack like its "joints" so leLab's exact click-drag-to-rotate works on our arm.
import { PointerURDFDragControls } from './vendor/URDFDragControls.js';
import { MujocoData, MujocoModel, MujocoModule } from './types';

/** One actuated arm joint, resolved from the MuJoCo model (actuator → joint → body). */
export interface ArmJointDesc {
  name: string;
  qadr: number;    // qpos address (joint angle)
  dofadr: number;  // qvel address (joint velocity)
  actId: number;   // actuator index (ctrl target that HOLDS the pose through mj_step)
  bodyId: number;  // the body this joint actuates → renderSys.bodies[bodyId]
  axis: [number, number, number]; // joint rotation axis, in the body's local frame
  lo: number; hi: number;          // limits (rad)
  prismatic: boolean;
}

/** The duck-type URDFDragControls looks for on a scene object. */
interface JointGroup extends THREE.Object3D {
  isURDFJoint?: boolean;
  jointType?: string;
  axis?: THREE.Vector3;
  angle?: number;
  __jointName?: string;
  __qadr?: number; __dofadr?: number; __actId?: number;
  __range?: [number, number];
  // Set on a GHOST arm's joint clones (non-physics) so updateJoint routes to per-arm angles, not qpos.
  __ghostArmId?: string; __jointIndex?: number;
}

/** One actuated joint's static info, keyed by the body it drives — for tagging ghost joints. */
export interface GhostJointDesc { index: number; axis: [number, number, number]; lo: number; hi: number; name: string }

/** Tag a GHOST arm group's joint-clones (RenderSystem.planningArmsGroup children) as draggable URDF
 *  joints, so the SAME drag engine jogs them — updateJoint routes to per-arm angles via __ghostArmId. */
export function tagGhostJoints(group: THREE.Object3D, byBody: Map<number, GhostJointDesc>, getJoints: (armId: string) => number[]) {
  for (const clone of group.children) {
    const armId = clone.userData.armId as string | undefined;
    if (!armId) continue;
    for (const child of clone.children) {
      const bid = child.userData.__bodyId as number | undefined;
      const d = bid !== undefined ? byBody.get(bid) : undefined;
      if (!d) continue;
      const g = child as JointGroup;
      g.isURDFJoint = true; g.jointType = 'revolute';
      g.axis = new THREE.Vector3(d.axis[0], d.axis[1], d.axis[2]);
      g.__jointName = d.name; g.__range = [d.lo, d.hi];
      g.__ghostArmId = armId; g.__jointIndex = d.index;
      Object.defineProperty(g, 'angle', { configurable: true, get: () => getJoints(armId)[d.index] ?? 0 });
    }
  }
}

export function untagGhostJoints(group: THREE.Object3D) {
  for (const clone of group.children) for (const child of clone.children) {
    const g = child as JointGroup;
    if (!g.isURDFJoint) continue;
    setEmissive(g, null);
    delete g.isURDFJoint; delete g.jointType; delete g.axis; delete g.__jointName; delete g.__range;
    delete g.__ghostArmId; delete g.__jointIndex; delete (g as Record<string, unknown>).angle;
  }
}

const HILITE = 0xff33aa; // leLab-style pink hover highlight

/** Tag MuJoCo arm body-groups so URDFDragControls treats them as draggable joints (duck typing). */
export function tagArmJoints(bodies: THREE.Object3D[], data: MujocoData, joints: ArmJointDesc[]) {
  for (const j of joints) {
    const g = bodies[j.bodyId] as JointGroup | undefined;
    if (!g) continue;
    g.isURDFJoint = true;
    g.jointType = j.prismatic ? 'prismatic' : 'revolute';
    g.axis = new THREE.Vector3(j.axis[0], j.axis[1], j.axis[2]);
    g.__jointName = j.name;
    g.__qadr = j.qadr; g.__dofadr = j.dofadr; g.__actId = j.actId;
    g.__range = [j.lo, j.hi];
    // `angle` reads live qpos so the drag math always accumulates from the true current angle.
    Object.defineProperty(g, 'angle', { configurable: true, get: () => data.qpos[j.qadr] });
  }
}

/** Remove the joint tags + any lingering highlight (when leaving pose mode). */
export function untagArmJoints(bodies: THREE.Object3D[], joints: ArmJointDesc[]) {
  for (const j of joints) {
    const g = bodies[j.bodyId] as JointGroup | undefined;
    if (!g) continue;
    setEmissive(g, null);
    delete g.isURDFJoint; delete g.jointType; delete g.axis;
    delete g.__jointName; delete g.__qadr; delete g.__dofadr; delete g.__actId; delete g.__range;
    delete (g as Record<string, unknown>).angle;
  }
}

/** Pink emissive on every mesh under the body group (originals saved + restored on unhover). */
function setEmissive(group: THREE.Object3D, hex: number | null) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const mat = m as THREE.MeshStandardMaterial;
      if (!mat || !mat.emissive) continue;
      const ud = mat.userData as { __origEmissive?: number };
      if (hex === null) {
        if (ud.__origEmissive !== undefined) { mat.emissive.setHex(ud.__origEmissive); delete ud.__origEmissive; }
      } else {
        if (ud.__origEmissive === undefined) ud.__origEmissive = mat.emissive.getHex();
        mat.emissive.setHex(hex);
      }
    }
  });
}

// Type the vendored base so we can extend it cleanly in TS.
type DragControlsCtor = new (scene: THREE.Object3D, camera: THREE.Camera, dom: HTMLElement) => {
  updateJoint(joint: JointGroup, angle: number): void;
  onDragStart(joint: JointGroup): void;
  onDragEnd(joint: JointGroup): void;
  onHover(joint: JointGroup): void;
  onUnhover(joint: JointGroup): void;
  dispose(): void;
};
const Base = PointerURDFDragControls as unknown as DragControlsCtor;

/**
 * MujocoJointDrag — leLab/urdf-loader's drag engine, adapted to drive MuJoCo. The base class does
 * all the work (raycast → nearest tagged joint → plane-projection angle from the drag); we only
 * override the seams:
 *   • updateJoint → write the actuator target (ctrl) + qpos + zero qvel so the position actuators
 *     HOLD the new pose through mj_step (writing qpos alone would be undone by physics next frame),
 *   • onDragStart/End → freeze OrbitControls while dragging a joint,
 *   • onHover/Unhover → pink highlight + a "Joint: …" label, like leLab.
 */
export class MujocoJointDrag extends Base {
  private mujoco!: MujocoModule;
  private model!: MujocoModel;
  private data!: MujocoData;
  private orbit!: OrbitControls;
  onJointLabel?: (name: string | null) => void;
  /** Fired when a joint drag finishes — lets ghost arms re-mirror the newly-posed primary. */
  onPosed?: () => void;
  /** Drag on a GHOST arm joint → set that arm's stored joint angle (no physics) + re-pose it. */
  onGhostJoint?: (armId: string, index: number, angle: number) => void;
  /** Mode A: clamp a primary-arm joint angle to the last collision-free value before a post (the
   *  owner does the binary search against the reach planner). Identity when contact mode is off. */
  clampAngle?: (qadr: number, target: number) => number;

  static create(
    scene: THREE.Object3D, camera: THREE.Camera, dom: HTMLElement,
    mujoco: MujocoModule, model: MujocoModel, data: MujocoData, orbit: OrbitControls,
    onJointLabel?: (name: string | null) => void,
  ): MujocoJointDrag {
    const c = new MujocoJointDrag(scene, camera, dom);
    c.mujoco = mujoco; c.model = model; c.data = data; c.orbit = orbit; c.onJointLabel = onJointLabel;
    // The vendored controls bind to MOUSE events, but OrbitControls handles pointerdown and
    // preventDefault()s it — which suppresses the compat mousedown, so real clicks never grab a
    // joint (only synthetic MouseEvents did). Re-bind the SAME handlers to POINTER events, which
    // coexist with OrbitControls. (Handlers read e.clientX/clientY — present on PointerEvent too.)
    const h = c as unknown as { _mouseDown: (e: Event) => void; _mouseMove: (e: Event) => void; _mouseUp: (e: Event) => void };
    dom.removeEventListener('mousedown', h._mouseDown);
    dom.removeEventListener('mousemove', h._mouseMove);
    dom.removeEventListener('mouseup', h._mouseUp);
    dom.addEventListener('pointerdown', h._mouseDown);
    dom.addEventListener('pointermove', h._mouseMove);
    dom.addEventListener('pointerup', h._mouseUp);
    c.dom = dom;
    return c;
  }

  private dom!: HTMLElement;
  dispose() {
    const h = this as unknown as { _mouseDown: (e: Event) => void; _mouseMove: (e: Event) => void; _mouseUp: (e: Event) => void };
    this.dom.removeEventListener('pointerdown', h._mouseDown);
    this.dom.removeEventListener('pointermove', h._mouseMove);
    this.dom.removeEventListener('pointerup', h._mouseUp);
    this.orbit.enabled = true; // never leave orbit disabled if we were mid-drag
  }

  updateJoint(joint: JointGroup, angle: number) {
    const [lo, hi] = joint.__range ?? [-Math.PI, Math.PI];
    const a = Math.min(hi, Math.max(lo, angle));
    // Ghost arm joint → no physics; route to the per-arm angle store + an in-place re-pose.
    if (joint.__ghostArmId !== undefined) { this.onGhostJoint?.(joint.__ghostArmId, joint.__jointIndex ?? 0, a); return; }
    const a2 = this.clampAngle ? this.clampAngle(joint.__qadr!, a) : a; // Mode A: stop at the post
    this.data.qpos[joint.__qadr!] = a2;
    (this.data as unknown as { qvel: Float64Array }).qvel[joint.__dofadr!] = 0;
    if ((joint.__actId ?? -1) >= 0) this.data.ctrl[joint.__actId!] = a2;
    this.mujoco.mj_forward(this.model, this.data);
  }

  onDragStart() { this.orbit.enabled = false; }
  onDragEnd() { this.orbit.enabled = true; this.onPosed?.(); }
  onHover(joint: JointGroup) { setEmissive(joint, HILITE); this.onJointLabel?.(joint.__jointName ?? null); }
  onUnhover(joint: JointGroup) { setEmissive(joint, null); this.onJointLabel?.(null); }
}
