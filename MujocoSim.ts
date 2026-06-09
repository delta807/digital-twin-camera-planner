/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import * as THREE from 'three';
import { DragStateManager } from './DragStateManager';
import { IkSystem } from './IkSystem';
import { RenderSystem } from './RenderSystem';
import { BasePose, RobotLoader } from './RobotLoader';
import { SelectionManager } from './SelectionManager';
import { SequenceAnimator } from './SequenceAnimator';
import { ArmInstance, DEFAULT_WORKCELL_CONFIG, MujocoData, MujocoModel, MujocoModule, WorkcellConfig } from './types';
import { getName } from './utils/StringUtils';
import { SweptJoint, WorkspacePlanner } from './WorkspacePlanner';
import { NumericIk } from './NumericIk';
import { ArmJointDesc, GhostJointDesc, MujocoJointDrag, tagArmJoints, tagGhostJoints, untagArmJoints, untagGhostJoints } from './MujocoJointDrag';

/** Physics snapshot of the task/cube freejoints — for the undo/redo timeline (these live in mjData,
 *  not React state). */
export interface TaskStateSnap {
  items: Array<{ bodyId: number; geomId: number; qadr: number; qpos: number[]; contype: number; conaff: number; vis: boolean }>;
  pool: boolean[];
}

/**
 * MujocoSim: The Central Orchestrator.
 * Manages the connection between the MuJoCo WASM engine and the Three.js visualization.
 */
export class MujocoSim {
    mujoco: MujocoModule;      
    mjModel: MujocoModel | null = null;     
    mjData: MujocoData | null = null;      
    mjvOption: InstanceType<MujocoModule['MjvOption']>;   

    renderSys: RenderSystem;
    ikSys: IkSystem;
    dragStateManager: DragStateManager;
    selectionManager: SelectionManager;
    sequenceAnimator: SequenceAnimator;

    frameId: number | null = null;
    paused = false;
    gripperActuatorId = -1;
    speedMultiplier = 1;

    /** True for the Franka demo (analytical IK + Gemini pickup); false for the SO-101 twin. */
    isFranka = true;
    /** SO-101 reachability / base-placement planner (null for Franka). */
    planner: WorkspacePlanner | null = null;
    /** Position-only numeric IK for the SO-101 (null for Franka, which uses analytical IK). */
    private numericIk: NumericIk | null = null;
    /** Interactive joint posing (leLab-style click-drag), adapted from urdf-loader's drag engine. */
    private jointDrag: MujocoJointDrag | null = null;
    private armJointDescs: ArmJointDesc[] = [];
    poseMode = false;
    private armJointQadr: number[] = [];
    /** Fired after a (re)load creates a new planner, so React can re-apply its state. */
    onSceneReload: (() => void) | null = null;
    private loading = false; // re-entrancy guard for init() (base/arm/workcell reloads)
    private robotId = '';
    private sceneFile = 'scene.xml';
    private basePose: BasePose | null = null;
    private workcellConfig: WorkcellConfig = { ...DEFAULT_WORKCELL_CONFIG };
    private armInstances: ArmInstance[] = [];
    private baseBodyId = 0;
    private armBodyIds: number[] = [];
    /** Pre-allocated freejoint cube pool — spawn/despawn graspable blocks at runtime, no model reload
     *  (mjSpec recompile is unbound in mujoco-wasm). Despawned slots are parked far below the floor
     *  with collisions OFF + hidden; spawning re-poses one, re-enables collision, and shows it. */
    private blockPool: { bodyId: number; geomId: number; qadr: number; dadr: number; used: boolean }[] = [];

    private userIkEnabled = false;
    private firstIkEnable = true; // Track first enable to enforce default rotation
    private lastLoopMs = 0;       // wall-clock of the previous frame (frame-rate-independent timing)

    /** SO-101 scripted grasp sequence (approach → descend → close → lift → release per item). */
    private so101Pickup: {
        queue: { pos: THREE.Vector3; markerId: number }[];
        idx: number;
        phase: number; // 0 approach,1 descend,2 close,3 lift,4 carry,5 lower,6 release
        t: number;     // seconds elapsed in the current phase
        onFinished?: () => void;
        grab: { qposAdr: number; dofAdr: number; offset: THREE.Vector3 } | null;
    } | null = null;

    // Gizmo Interpolation State
    private gizmoAnim = {
        active: false,
        startPos: new THREE.Vector3(),
        endPos: new THREE.Vector3(),
        startRot: new THREE.Quaternion(),
        endRot: new THREE.Quaternion(),
        startTime: 0,
        duration: 1000
    };

    constructor(container: HTMLElement, mujocoInstance: MujocoModule) {
        this.mujoco = mujocoInstance;
        this.mjvOption = new this.mujoco.MjvOption();
        
        this.renderSys = new RenderSystem(container, this.mujoco);
        
        this.dragStateManager = new DragStateManager(this.renderSys.scene, this.renderSys.renderer, this.renderSys.camera, container, this.renderSys.controls);
        this.selectionManager = new SelectionManager(this.renderSys.scene, this.renderSys.renderer, this.renderSys.camera, container);
        
        this.ikSys = new IkSystem(this.mujoco, this.renderSys.camera, this.renderSys.renderer.domElement, this.renderSys.controls);
        this.renderSys.simGroup.add(this.ikSys.target); 
        this.renderSys.scene.add(this.ikSys.helper);
        
        this.sequenceAnimator = new SequenceAnimator();
        
        this.renderSys.initLights(this.dragStateManager);
    }

    async init(robotId = 'so_arm100', sceneFile = 'scene.xml', onProgress?: (msg: string) => void, basePose?: BasePose, workcellConfig?: WorkcellConfig) {
        // Drop overlapping reloads (e.g. a fast second base-drag while the first is still awaiting
        // the async loader) — racing the model teardown could double-delete or build on a torn
        // down model. The latest committed pose still wins via the caller's stored basePose.
        if (this.loading) return;
        this.loading = true;
        try {
        this.robotId = robotId;
        this.sceneFile = sceneFile;
        if (basePose !== undefined) this.basePose = basePose;
        if (workcellConfig !== undefined) this.workcellConfig = { ...workcellConfig };
        this.isFranka = robotId.includes('franka');

        // Tear down any previous model/data/planner (also supports base-relocation reloads).
        if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = null; }
        this.so101Pickup = null; // a mid-flight grasp holds addresses into the OLD model — drop it
        if (this.planner) { this.planner.dispose(); this.planner = null; this.renderSys.extraPipHelpers = []; }
        if (this.jointDrag) { this.jointDrag.dispose(); this.jointDrag = null; this.poseMode = false; } // stale body refs on reload
        if (this.numericIk) { this.numericIk.dispose(); this.numericIk = null; }
        if (this.mjData) { try { this.mjData.delete(); } catch (e) { /* ignore */ } this.mjData = null; }
        if (this.mjModel) { try { this.mjModel.delete(); } catch (e) { /* ignore */ } this.mjModel = null; }

        const loader = new RobotLoader(this.mujoco);
        const { isDouble, isStacking } = await loader.load(robotId, sceneFile, onProgress, this.basePose ?? undefined, this.workcellConfig);

        try {
            this.mjModel = this.mujoco.MjModel.loadFromXML(`/working/${sceneFile}`);
            this.mjData = new this.mujoco.MjData(this.mjModel);
        } catch (e: unknown) {
            throw new Error(`Failed to load model: ${(e as Error).message}`);
        }
        if (!this.mjModel || !this.mjData) return;

        // TCP site + gripper actuator (both robots inject a 'tcp' site).
        this.ikSys.gripperSiteId = -1;
        this.gripperActuatorId = -1;
        for (let i = 0; i < this.mjModel.nsite; i++) {
            if (getName(this.mjModel, this.mjModel.name_siteadr[i]).includes('tcp')) { this.ikSys.gripperSiteId = i; break; }
        }
        this.renderSys.gripperSiteId = this.ikSys.gripperSiteId; // let the wrist cam track the TCP
        for (let i = 0; i < this.mjModel.nu; i++) {
            const an = getName(this.mjModel, this.mjModel.name_actuatoradr[i]);
            if (an.toLowerCase().includes('gripper') || an === 'Jaw') { this.gripperActuatorId = i; break; }
        }

        this.setInitialPose();
        this.mujoco.mj_forward(this.mjModel, this.mjData);
        this.renderSys.initScene(this.mjModel);
        this.renderSys.syncBodiesFromData(this.mjData);
        this.buildBlockPool();
        this.initPostColliders();

        if (this.isFranka) {
            this.ikSys.init(this.mjModel, isDouble);
            this.ikSys.syncToSite(this.mjData);
            this.ikSys.target.quaternion.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
            this.ikSys.target.position.set(0, 0, 0.45);
            this.firstIkEnable = true;
            this.sequenceAnimator.init(this.mjModel, isStacking, (addr) => getName(this.mjModel!, addr));
            this.setIkEnabled(false);
        } else {
            // SO-101 twin: no analytical IK; arm holds its pose. Stand up the planner.
            this.ikSys.setCalculating(false);
            this.ikSys.setGizmoVisible(false);
            this.ikSys.setTargetVisible(false);
            this.renderSys.baseBuilder.rebuild(this.workcellConfig);
            this.setupPlanner();
        }

        this.startLoop();
        if (!this.isFranka && this.onSceneReload) this.onSceneReload();
        } finally {
            this.loading = false;
        }
    }

    /** Build the reachability/base-placement planner from the loaded SO-101 model. */
    private setupPlanner() {
        const m = this.mjModel;
        if (!m) return;
        // Resolve each actuator's joint qpos address via the actuator->joint transmission
        // (same reliable path setInitialPose uses). SO-101 actuator order is fixed:
        // [Rotation, Pitch, Elbow, Wrist_Pitch, Wrist_Roll, Jaw].
        const actuatorQadr = (i: number): number => {
            const jid = m.actuator_trnid[2 * i];
            return (jid >= 0 && jid < m.njnt) ? m.jnt_qposadr[jid] : -1;
        };
        // Real SO-101 follower joint limits (rad) from so101_new_calib.urdf, for the 4
        // position-driving joints [shoulder_pan, shoulder_lift, elbow_flex, wrist_flex].
        // NOTE: these are TIGHTER than the Menagerie model's "approximate" limits (esp.
        // shoulder_lift/elbow), so the reachable footprint matches the real arm — and the
        // ±1.92 rad (±110°) base rotation is why reach is a fan, not a full 360° ring.
        const ranges: Array<[number, number]> = [[-1.91986, 1.91986], [-1.74533, 1.74533], [-1.69, 1.69], [-1.65806, 1.65806]];
        const sweptJoints: SweptJoint[] = ranges
            .map((r, i) => ({ qposAdr: actuatorQadr(i), lo: r[0], hi: r[1] }))
            .filter(j => j.qposAdr >= 0);
        const zeroQposAdr = [4, 5].map(actuatorQadr).filter(a => a >= 0); // Wrist_Roll, Jaw

        let baseBodyId = 0;
        const taskBodyIds: number[] = [];
        for (let i = 0; i < m.nbody; i++) {
            const nm = getName(m, m.name_bodyadr[i]);
            if (nm === 'Base') baseBodyId = i;
            if (nm.startsWith('task')) taskBodyIds.push(i);
        }
        this.baseBodyId = baseBodyId;
        this.armBodyIds = this.descendantBodyIds(baseBodyId);
        this.armJointDescs = this.buildArmJointDescs(m);

        if (this.ikSys.gripperSiteId < 0 || sweptJoints.length < 4) {
            console.warn('Planner: missing TCP site or swept joints — reachability disabled.');
            return;
        }
        this.planner = new WorkspacePlanner(this.renderSys.scene, {
            model: m, mujoco: this.mujoco, tcpSiteId: this.ikSys.gripperSiteId,
            sweptJoints, zeroQposAdr, baseBodyId, taskBodyIds,
            mainCamera: this.renderSys.camera, domElement: this.renderSys.renderer.domElement,
            orbitControls: this.renderSys.controls, onRelocate: (x, y) => this.relocateBase(x, y),
            baseSearchHalfX: Math.max(0.1, this.workcellConfig.length / 2 - 0.05),
            baseSearchHalfY: Math.max(0.1, this.workcellConfig.width / 2 - 0.05),
        });
        this.renderSys.extraPipHelpers = [this.planner.group, this.planner.gizmoHelper];
        this.renderSys.buildPlanningArmTemplate(this.armBodyIds, this.baseBodyId, this.currentTcpWorld());
        this.renderSys.setPlanningArmInstances(this.armInstances, (j) => this.armPoseTransforms(j));
        this.planner.setArms(this.armInstances, this.basePose?.yaw ?? 0);
        this.planner.computeReachability();

        // Numeric IK (position-only) for "click object → arm reaches to it" on the SO-101.
        this.armJointQadr = sweptJoints.map((j) => j.qposAdr);
        this.numericIk = new NumericIk(
            this.mujoco, m, this.ikSys.gripperSiteId,
            this.armJointQadr, sweptJoints.map((j) => j.lo), sweptJoints.map((j) => j.hi),
        );
    }

    /** Current gripper-site world transform (orientation + position) for the ghost TCP marker. */
    private currentTcpWorld(): THREE.Matrix4 | undefined {
        const s = this.ikSys.gripperSiteId;
        if (s < 0 || !this.mjData) return undefined;
        const xm = this.mjData.site_xmat, xp = this.mjData.site_xpos;
        return new THREE.Matrix4().set(
            xm[s * 9 + 0], xm[s * 9 + 1], xm[s * 9 + 2], xp[s * 3 + 0],
            xm[s * 9 + 3], xm[s * 9 + 4], xm[s * 9 + 5], xp[s * 3 + 1],
            xm[s * 9 + 6], xm[s * 9 + 7], xm[s * 9 + 8], xp[s * 3 + 2],
            0, 0, 0, 1,
        );
    }

    /** Re-snapshot the planning-arm template from the primary's CURRENT pose + re-place the ghosts,
     *  so every ghost arm mirrors however the primary is posed (and its wrist cam frames to match). */
    refreshGhostArms(): void {
        if (this.isFranka || !this.mjModel) return;
        this.renderSys.buildPlanningArmTemplate(this.armBodyIds, this.baseBodyId, this.currentTcpWorld());
        this.renderSys.setPlanningArmInstances(this.armInstances, (j) => this.armPoseTransforms(j));
    }

    /** Show/hide a scene entity from the object tree's eye toggle. The render loop only syncs body
     *  position/quaternion (not visibility), so a hidden body stays hidden. */
    setEntityVisible(kind: 'arm' | 'camera' | 'post' | 'object' | 'station' | 'wristcam' | 'prop', id: number | string | undefined, visible: boolean): void {
        const rs = this.renderSys;
        if (kind === 'object' && typeof id === 'number') { if (rs.bodies[id]) rs.bodies[id].visible = visible; }
        else if (kind === 'prop') { rs.baseBuilder.group.children.forEach((m) => { if (m.userData?.selectable === 'prop' && m.userData?.propId === id) m.visible = visible; }); }
        else if (kind === 'wristcam') { const c = rs.getWristCamera(typeof id === 'string' ? id : undefined); if (c?.glyph) c.glyph.visible = visible; }
        else if (kind === 'arm') {
            // The PRIMARY arm is the physics body chain (armBodyIds); non-primary arms are ghost
            // clones in planningArmsGroup tagged with their armId. Only touch the physics bodies when
            // THIS id is the primary — otherwise hiding a ghost ("SO101 2") wrongly hid the real arm.
            const isPrimary = id === undefined || this.armInstances.find((a) => a.id === id)?.primary === true;
            if (isPrimary) for (const b of this.armBodyIds) if (rs.bodies[b]) rs.bodies[b].visible = visible;
            rs.planningArmsGroup.children.forEach((g) => { if (g.userData.armId === id) g.visible = visible; });
        }
        else if (kind === 'station') rs.baseBuilder.group.children.forEach((m) => { if (m.userData?.stationId === id) m.visible = visible; });
        else if (kind === 'post') {
            // Extra post → by index; the PRIMARY camera post → only the one tagged selectable='post'
            // with no postIndex (was hiding ALL posts, incl. extras + satellite posts — #4).
            if (typeof id === 'number') rs.baseBuilder.group.children.forEach((m) => { if (m.userData?.selectable === 'post' && m.userData?.postIndex === id) m.visible = visible; });
            else rs.baseBuilder.group.children.forEach((m) => { if (m.userData?.selectable === 'post' && m.userData?.postIndex === undefined) m.visible = visible; });
        }
        else if (kind === 'camera') {
            if (typeof id === 'string') { const c = rs.getExtraCamera(id); if (c) { c.glyph.userData.hiddenByUser = !visible; c.glyph.visible = visible; } }
            else rs.cameraRig.gizmo.visible = visible;
        }
    }

    /** Resolve every actuated arm joint (actuator → joint → body) for interactive posing. */
    private buildArmJointDescs(m: MujocoModel): ArmJointDesc[] {
        const M = m as unknown as {
            jnt_type: Int32Array; jnt_range: Float64Array; jnt_axis: Float64Array;
            jnt_bodyid: Int32Array; jnt_dofadr: Int32Array;
        };
        const names = ['Rotation', 'Pitch', 'Elbow', 'Wrist_Pitch', 'Wrist_Roll', 'Jaw'];
        const descs: ArmJointDesc[] = [];
        for (let i = 0; i < m.nu; i++) {
            const jid = m.actuator_trnid[2 * i];
            if (jid < 0 || jid >= m.njnt) continue;
            const jt = M.jnt_type[jid];
            if (jt !== 3 && jt !== 2) continue; // 3 = hinge (revolute), 2 = slide (prismatic)
            let lo = M.jnt_range[2 * jid], hi = M.jnt_range[2 * jid + 1];
            if (!(hi > lo)) { lo = -Math.PI; hi = Math.PI; } // unlimited joint → sane drag range
            descs.push({
                name: names[i] ?? `Joint ${i}`,
                qadr: m.jnt_qposadr[jid], dofadr: M.jnt_dofadr[jid], actId: i,
                bodyId: M.jnt_bodyid[jid],
                axis: [M.jnt_axis[3 * jid], M.jnt_axis[3 * jid + 1], M.jnt_axis[3 * jid + 2]],
                lo, hi, prismatic: jt === 2,
            });
        }
        return descs;
    }

    /**
     * Enter/leave interactive joint posing: click any link of the SO-101 and drag to rotate that
     * joint (leLab-style). Tags the arm body-groups as draggable joints + spins up the adapted
     * urdf-loader drag engine; disables click-to-select so clicks go to joints, not the inspector.
     */
    setPoseMode(on: boolean, onJointLabel?: (name: string | null) => void): void {
        if (this.isFranka || !this.mjModel || !this.mjData) return;
        this.poseMode = on;
        const rs = this.renderSys;
        if (on) {
            tagArmJoints(rs.bodies, this.mjData, this.armJointDescs);
            // Raycast the whole SCENE so the SAME engine grabs both the physics arm (simGroup) and the
            // GHOST joints (planningArmsGroup). The raycaster now has its camera set (vendor fix), so
            // fat-line overlays no longer throw, and update() skips non-joint occluders.
            this.jointDrag = MujocoJointDrag.create(
                rs.scene, rs.camera, rs.renderer.domElement,
                this.mujoco, this.mjModel, this.mjData, rs.controls, onJointLabel,
            );
            this.jointDrag.onPosed = () => this.refreshGhostArms();
            this.jointDrag.onGhostJoint = (armId, index, angle) => this.poseGhostJoint(armId, index, angle);
            this.jointDrag.applyPrimary = (qadr, dofadr, actId, target) => this.applyPrimaryJoint(qadr, dofadr, actId, target); // contact-aware write
            tagGhostJoints(rs.planningArmsGroup, this.ghostJointDescByBody(), (id) => this.ghostJoints(id));
            rs.selection.setSkipArm(true); // arm-link clicks drive joints; other objects still select
        } else {
            this.jointDrag?.dispose();
            this.jointDrag = null;
            untagArmJoints(rs.bodies, this.armJointDescs);
            untagGhostJoints(rs.planningArmsGroup);
            rs.selection.setSkipArm(false);
            onJointLabel?.(null);
        }
    }

    /** Reload the model with the arm base moved/rotated — the "drag the mount" path. */
    /**
     * Move the (welded) arm base LIVE — no model reload. MuJoCo permits editing real-valued
     * params after compile, so we set the Base body's `body_pos`/`body_quat` and run `mj_forward`
     * to teleport the whole arm subtree (its joint qpos are relative, so the pose is preserved).
     * Fixes the old reload-flash + "apply pose" clunk; the reach overlay follows via setArms.
     */
    relocateBase(x: number, y: number, yaw = this.basePose?.yaw ?? 0): Promise<void> {
        if (this.isFranka || !this.mjModel || !this.mjData) return Promise.resolve();
        this.basePose = { x, y, yaw };
        const b = this.baseBodyId;
        const bp = this.mjModel.body_pos as unknown as Float32Array;
        const bq = this.mjModel.body_quat as unknown as Float32Array;
        bp[b * 3] = x;
        bp[b * 3 + 1] = y;
        // (z left at its loaded value so the base stays on the floor)
        const h = yaw * 0.5;
        bq[b * 4] = Math.cos(h); bq[b * 4 + 1] = 0; bq[b * 4 + 2] = 0; bq[b * 4 + 3] = Math.sin(h);
        this.mujoco.mj_forward(this.mjModel, this.mjData);
        // Re-place the reach overlay + ghosts at the new base pose (no recompute needed).
        this.planner?.setArms(this.armInstances, yaw);
        return Promise.resolve();
    }

    /** Live worktop update — the table is Three.js-only now, so NO model reload is needed. */
    setWorkcell(config: WorkcellConfig) {
        if (this.isFranka) return;
        this.workcellConfig = { ...config };
        this.renderSys.baseBuilder.rebuild(this.workcellConfig);
        this.planner?.setSearchBounds(
            Math.max(0.1, this.workcellConfig.length / 2 - 0.05),
            Math.max(0.1, this.workcellConfig.width / 2 - 0.05),
        );
    }

    /** Index the baked freejoint cube pool (bodies named `cube{i}`) and park them all as despawned. */
    private buildBlockPool() {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d) return;
        this.blockPool = [];
        for (let i = 0; i < m.nbody; i++) {
            if (!/^cube\d+$/.test(getName(m, m.name_bodyadr[i]))) continue;
            const jadr = m.body_jntadr[i];
            if (jadr < 0 || m.jnt_type[jadr] !== 0) continue; // freejoint only
            const slot = { bodyId: i, geomId: m.body_geomadr[i], qadr: m.jnt_qposadr[jadr], dadr: m.jnt_dofadr[jadr], used: false };
            this.blockPool.push(slot);
            this.parkBlock(slot); // start despawned (hidden, no collision, under the floor)
        }
        if (this.blockPool.length) this.mujoco.mj_forward(m, d);
    }

    private parkBlock(slot: { bodyId: number; geomId: number; qadr: number; dadr: number; used: boolean }) {
        const m = this.mjModel!, d = this.mjData!;
        m.geom_contype[slot.geomId] = 0; m.geom_conaffinity[slot.geomId] = 0; // no collisions while parked
        d.qpos[slot.qadr] = 0; d.qpos[slot.qadr + 1] = 0; d.qpos[slot.qadr + 2] = -5 - slot.bodyId * 0.1;
        d.qpos[slot.qadr + 3] = 1; d.qpos[slot.qadr + 4] = 0; d.qpos[slot.qadr + 5] = 0; d.qpos[slot.qadr + 6] = 0;
        for (let k = 0; k < 6; k++) d.qvel[slot.dadr + k] = 0;
        if (this.renderSys.bodies[slot.bodyId]) this.renderSys.bodies[slot.bodyId].visible = false;
        slot.used = false;
    }

    /** Spawn a graspable cube from the pool at (x,y). Returns its bodyId (selectable/movable like any
     *  task block) or null if the pool is exhausted. Live — no model reload, no flash. */
    spawnBlock(x: number, y: number, z = 0.018): number | null {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d) return null;
        const slot = this.blockPool.find((p) => !p.used);
        if (!slot) return null;
        d.qpos[slot.qadr] = x; d.qpos[slot.qadr + 1] = y; d.qpos[slot.qadr + 2] = z;
        d.qpos[slot.qadr + 3] = 1; d.qpos[slot.qadr + 4] = 0; d.qpos[slot.qadr + 5] = 0; d.qpos[slot.qadr + 6] = 0;
        for (let k = 0; k < 6; k++) d.qvel[slot.dadr + k] = 0;
        m.geom_contype[slot.geomId] = 1; m.geom_conaffinity[slot.geomId] = 1;
        if (this.renderSys.bodies[slot.bodyId]) this.renderSys.bodies[slot.bodyId].visible = true;
        slot.used = true;
        this.mujoco.mj_forward(m, d);
        return slot.bodyId;
    }

    /** Despawn a pooled cube (back to parked/hidden). No-op for non-pool bodies. Live — no reload. */
    despawnBlock(bodyId: number): boolean {
        const slot = this.blockPool.find((p) => p.bodyId === bodyId);
        if (!slot || !this.mjModel || !this.mjData) return false;
        this.parkBlock(slot);
        this.mujoco.mj_forward(this.mjModel, this.mjData);
        return true;
    }

    /** How many pool cubes remain free (for UI / "pool exhausted" messaging). */
    freeBlockCount(): number { return this.blockPool.filter((p) => !p.used).length; }

    /** Capture the physics state of every task/cube freejoint (pose + collision masks + visibility +
     *  pool used-flags) — so the undo/redo timeline can include cube moves/spawns/despawns, which
     *  live in mjData rather than React state. */
    snapshotTaskState(): TaskStateSnap | null {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d) return null;
        const items: TaskStateSnap['items'] = [];
        for (let i = 0; i < m.nbody; i++) {
            if (!/^(task|cube)/.test(getName(m, m.name_bodyadr[i]))) continue;
            const jadr = m.body_jntadr[i];
            if (jadr < 0 || m.jnt_type[jadr] !== 0) continue; // freejoint only
            const a = m.jnt_qposadr[jadr], gid = m.body_geomadr[i];
            items.push({
                bodyId: i, geomId: gid, qadr: a,
                qpos: [d.qpos[a], d.qpos[a + 1], d.qpos[a + 2], d.qpos[a + 3], d.qpos[a + 4], d.qpos[a + 5], d.qpos[a + 6]],
                contype: m.geom_contype[gid], conaff: m.geom_conaffinity[gid],
                vis: this.renderSys.bodies[i]?.visible ?? true,
            });
        }
        return { items, pool: this.blockPool.map((p) => p.used) };
    }

    /** Restore a task/cube physics snapshot (poses + collision + visibility + pool flags). */
    restoreTaskState(s: TaskStateSnap | null) {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d || !s) return;
        for (const it of s.items) {
            for (let k = 0; k < 7; k++) d.qpos[it.qadr + k] = it.qpos[k];
            const jadr = m.body_jntadr[it.bodyId];
            if (jadr >= 0) { const dof = m.jnt_dofadr[jadr]; for (let k = 0; k < 6; k++) d.qvel[dof + k] = 0; }
            m.geom_contype[it.geomId] = it.contype; m.geom_conaffinity[it.geomId] = it.conaff;
            if (this.renderSys.bodies[it.bodyId]) this.renderSys.bodies[it.bodyId].visible = it.vis;
        }
        s.pool.forEach((used, i) => { if (this.blockPool[i]) this.blockPool[i].used = used; });
        this.mujoco.mj_forward(m, d);
    }

    /** List the movable task blocks (for the object tree) — excludes despawned pool slots. */
    getTaskBodies(): { bodyId: number; name: string }[] {
        const m = this.mjModel;
        if (!m) return [];
        const despawned = new Set(this.blockPool.filter((p) => !p.used).map((p) => p.bodyId));
        const out: { bodyId: number; name: string }[] = [];
        for (let i = 0; i < m.nbody; i++) {
            const n = getName(m, m.name_bodyadr[i]);
            if (/^(task|cube|tray)/.test(n) && !despawned.has(i)) out.push({ bodyId: i, name: n });
        }
        return out;
    }

    /** Teleport a freejoint task block to a world position (from the transform panel). */
    setTaskBodyPosition(bodyId: number, x: number, y: number, z: number) {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d) return;
        const jadr = m.body_jntadr[bodyId];
        if (jadr < 0 || m.jnt_type[jadr] !== 0) return; // only dynamic (freejoint) blocks
        const a = m.jnt_qposadr[jadr];
        d.qpos[a] = x; d.qpos[a + 1] = y; d.qpos[a + 2] = Math.max(z, 0.018);
        // Preserve the block's orientation (don't snap to identity) so a Move after an Aim keeps its yaw.
        const dof = m.jnt_dofadr[jadr];
        for (let k = 0; k < 6; k++) d.qvel[dof + k] = 0;
        this.mujoco.mj_forward(m, d);
    }

    /** Rigidly carry every task block with a worktop move: translate by (dx,dy) and rotate dyaw about
     *  the pivot (the worktop's previous origin). Lets blocks ride along when the workcell is dragged
     *  — live, no reload. Orientation is composed so a block keeps its own yaw. */
    transformTaskBodies(dx: number, dy: number, dyaw: number, pivotX: number, pivotY: number) {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d) return;
        const c = Math.cos(dyaw), s = Math.sin(dyaw);
        const rh = dyaw / 2, rw = Math.cos(rh), rz = Math.sin(rh); // half-angle quat for the Z rotation
        for (const { bodyId } of this.getTaskBodies()) {
            const jadr = m.body_jntadr[bodyId];
            if (jadr < 0 || m.jnt_type[jadr] !== 0) continue; // freejoint blocks only
            const a = m.jnt_qposadr[jadr];
            const ox = d.qpos[a] - pivotX, oy = d.qpos[a + 1] - pivotY;
            d.qpos[a] = pivotX + (ox * c - oy * s) + dx;
            d.qpos[a + 1] = pivotY + (ox * s + oy * c) + dy;
            if (dyaw) {
                const qw = d.qpos[a + 3], qx = d.qpos[a + 4], qy = d.qpos[a + 5], qz = d.qpos[a + 6];
                d.qpos[a + 3] = rw * qw - rz * qz; d.qpos[a + 4] = rw * qx - rz * qy;
                d.qpos[a + 5] = rw * qy + rz * qx; d.qpos[a + 6] = rw * qz + rz * qw;
            }
            const dof = m.jnt_dofadr[jadr];
            for (let k = 0; k < 6; k++) d.qvel[dof + k] = 0;
        }
        this.mujoco.mj_forward(m, d);
    }

    /** Rotate a freejoint task block about Z (yaw, radians), keeping its position. */
    setTaskBodyYaw(bodyId: number, yaw: number) {
        const m = this.mjModel, d = this.mjData;
        if (!m || !d) return;
        const jadr = m.body_jntadr[bodyId];
        if (jadr < 0 || m.jnt_type[jadr] !== 0) return; // freejoint only
        const a = m.jnt_qposadr[jadr];
        const h = yaw / 2;
        d.qpos[a + 3] = Math.cos(h); d.qpos[a + 4] = 0; d.qpos[a + 5] = 0; d.qpos[a + 6] = Math.sin(h);
        const dof = m.jnt_dofadr[jadr];
        for (let k = 0; k < 6; k++) d.qvel[dof + k] = 0;
        this.mujoco.mj_forward(m, d);
    }

    /** Greedy max-coverage placements for `n` arms (null if no planner). */
    suggestArmLayout(n: number) {
        return this.planner?.suggestArmLayout(n) ?? null;
    }

    /** Depth image from the overhead (first station) camera, for the analysis depth figure. Overlay
     *  groups (ghost arms, planner tiles/outline/gizmo) are hidden so only real geometry shows. */
    overheadDepth(w = 320, h = 180): { depth: Float32Array; w: number; h: number } | null {
        this.renderSys.cameraRig?.syncSensorToGizmo(); // pose the camera from its gizmo first
        const cam = this.renderSys.cameraRig?.sensorCamera; // the overhead D435i
        if (!cam) return null;
        const hide: THREE.Object3D[] = [this.renderSys.planningArmsGroup, ...this.renderSys.cameraRig.overlays];
        if (this.planner) hide.push(this.planner.group, this.planner.gizmoHelper);
        return this.renderSys.renderDepth(cam, w, h, hide);
    }

    /** Per-table-cell visibility for the overhead D435i + the wrist cam (+ their union), for the
     *  camera-coverage figure. Grid spans [-half, half]² (centred on the workcell origin) at `step`. */
    coverageGrids(half = 0.4, step = 0.025): { overhead: boolean[]; wrist: boolean[]; combined: boolean[]; n: number; half: number } | null {
        const rs = this.renderSys;
        rs.cameraRig?.syncSensorToGizmo(); // pose the overhead camera from its gizmo first
        const overheadCam = rs.cameraRig?.sensorCamera; if (!overheadCam) return null;
        const wristCam = [...rs.wristCameras.values()][0]?.camera;
        const n = Math.floor((2 * half) / step) + 1;
        const pts: THREE.Vector3[] = [];
        for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pts.push(new THREE.Vector3(-half + i * step, -half + j * step, 0.005));
        const overhead = rs.computeCoverage(overheadCam, pts);
        const wrist = wristCam ? rs.computeCoverage(wristCam, pts) : pts.map(() => false);
        const combined = overhead.map((v, i) => v || wrist[i]);
        return { overhead, wrist, combined, n, half };
    }

    setArmInstances(instances: ArmInstance[]) {
        this.armInstances = instances.map((arm) => ({ ...arm }));
        this.renderSys.setPlanningArmInstances(this.armInstances, (j) => this.armPoseTransforms(j));
        // Ghost arms moving doesn't need a recompute — just re-transform the reach outlines.
        this.planner?.setArms(this.armInstances, this.basePose?.yaw ?? 0);
        // Ghosts were re-cloned → if we're jogging, re-tag them so drag still grabs their joints.
        if (this.poseMode) tagGhostJoints(this.renderSys.planningArmsGroup, this.ghostJointDescByBody(), (id) => this.ghostJoints(id));
    }

    /** Fired when a ghost arm is drag-jogged, so React can persist the new per-arm joint angles. */
    onGhostPosed: ((armId: string, joints: number[]) => void) | null = null;
    private ghostJointDescByBody(): Map<number, GhostJointDesc> {
        const m = new Map<number, GhostJointDesc>();
        this.armJointDescs.forEach((j, index) => m.set(j.bodyId, { index, axis: j.axis, lo: j.lo, hi: j.hi, name: j.name }));
        return m;
    }
    /** A ghost arm's current joint angles (its stored pose, else the home rest pose). */
    private ghostJoints(armId: string): number[] {
        const a = this.armInstances.find((x) => x.id === armId);
        return a?.joints ?? (this.isFranka ? [] : MujocoSim.SO101_FACTORY_REST.slice());
    }
    /** Drag-jog a ghost joint: store the angle, re-pose that ghost in place, notify React. */
    private poseGhostJoint(armId: string, index: number, angle: number) {
        const seed = this.ghostJoints(armId);
        const joints = seed.slice(); joints[index] = angle;
        const a = this.armInstances.find((x) => x.id === armId); if (a) a.joints = joints;
        this.renderSys.poseGhost(armId, this.armPoseTransforms(joints));
        this.onGhostPosed?.(armId, joints);
    }

    /** A posed clone of the real arm geometry at the given base pose + joint angles — for the WebGL
     *  compare panes (so each captured setup renders the actual SO-101 meshes). */
    posedArmClone(x: number, y: number, yaw: number, joints?: number[]): THREE.Group | null {
        return this.renderSys.makePosedArmClone(x, y, yaw, joints ? this.armPoseTransforms(joints) : null);
    }

    /** Compare v2 — render the live scene as two scissor halves (A | B) with the one renderer. */
    setCompareSplit(targetA: { x: number; y: number; z: number }, targetB: { x: number; y: number; z: number }) {
        this.renderSys.setCompareSplit(new THREE.Vector3(targetA.x, targetA.y, targetA.z), new THREE.Vector3(targetB.x, targetB.y, targetB.z));
    }
    setCompareTargets(targetA: { x: number; y: number; z: number }, targetB: { x: number; y: number; z: number }) {
        this.renderSys.setCompareTargets(new THREE.Vector3(targetA.x, targetA.y, targetA.z), new THREE.Vector3(targetB.x, targetB.y, targetB.z));
    }
    clearCompareSplit() { this.renderSys.clearCompareSplit(); }

    /** The actuated joints' display info (name + limits) for per-arm jog sliders. */
    getArmJointInfo(): { name: string; lo: number; hi: number }[] {
        return this.armJointDescs.map((j) => ({ name: j.name, lo: j.lo, hi: j.hi }));
    }

    /** Contact behaviour when jogging the arm into a mount post.
     *  'off'   = no constraint (jog passes through);
     *  'clamp' = Mode A: clamp the jogged joint at the post-contact boundary (hard stop, like a joint limit). */
    private contactMode: 'off' | 'clamp' | 'physics' = 'off';
    private postColliders: { geomId: number; mocapId: number }[] = []; // baked postcol{i} mocap pool
    setContactMode(mode: 'off' | 'clamp' | 'physics') {
        this.contactMode = mode;
        this.physicsTargets.clear();
        if (mode === 'physics') { // seed each joint's target at its current angle so the arm holds, not drifts
            const d = this.mjData;
            if (d) for (const j of this.armJointDescs) if (j.actId >= 0) this.physicsTargets.set(j.actId, d.qpos[j.qadr]);
        } else {
            this.syncPostColliders([]); // park the colliders unless in physics mode
        }
    }

    /** Per-frame (called before mj_step in 'physics' mode): walk each arm actuator's ctrl toward its
     *  commanded target, but never more than LEAD ahead of the live qpos — so the servo torque stays
     *  bounded and the post-contact geoms can stop the arm instead of being tunnelled through. */
    private advancePhysicsCtrl() {
        const d = this.mjData; if (this.contactMode !== 'physics' || !d) return;
        const LEAD = 0.05;
        for (const j of this.armJointDescs) {
            if (j.actId < 0) continue;
            const target = this.physicsTargets.get(j.actId); if (target == null) continue;
            const cur = d.qpos[j.qadr];
            d.ctrl[j.actId] = Math.max(cur - LEAD, Math.min(cur + LEAD, target));
        }
    }

    /** Index the baked mocap post-collider pool (bodies/geoms named `postcol{i}`) and park them all. */
    private initPostColliders() {
        const m = this.mjModel; if (!m) return;
        this.postColliders = [];
        for (let g = 0; g < m.ngeom; g++) {
            if (!/^postcol\d+$/.test(getName(m, m.name_geomadr[g]))) continue;
            const bodyId = m.geom_bodyid[g];
            this.postColliders.push({ geomId: g, mocapId: m.body_mocapid[bodyId] });
        }
        for (const c of this.postColliders) this.parkPostCollider(c);
    }

    private parkPostCollider(c: { geomId: number; mocapId: number }) {
        const m = this.mjModel!, d = this.mjData!;
        m.geom_contype[c.geomId] = 0; m.geom_conaffinity[c.geomId] = 0; // no collisions while parked
        if (c.mocapId >= 0) d.mocap_pos[c.mocapId * 3 + 2] = -20; // sink the mocap body below the floor
    }

    /** Mode B: position/size/enable the mocap collider pool to match the given posts (world XY, r,
     *  height 0→zTop) so the arm + cubes physically contact the posts during mj_step. Only active in
     *  'physics' mode; otherwise every collider is parked (off). Mocap bodies move via data.mocap_pos
     *  (dynamic broadphase → collisions update), with per-geom size set for the post's r/height. */
    syncPostColliders(posts: Array<{ x: number; y: number; r: number; zTop: number }>) {
        const m = this.mjModel, d = this.mjData; if (!m || !d) return;
        if (!this.postColliders.length) this.initPostColliders();
        const active = this.contactMode === 'physics' ? posts : [];
        this.postColliders.forEach((c, i) => {
            const post = active[i];
            if (post && post.zTop > 0 && c.mocapId >= 0) {
                m.geom_size[c.geomId * 3] = post.r; m.geom_size[c.geomId * 3 + 1] = post.zTop / 2; // radius, half-height
                m.geom_pos[c.geomId * 3 + 2] = post.zTop / 2;                                      // base at body z=0 → top at zTop
                d.mocap_pos[c.mocapId * 3] = post.x; d.mocap_pos[c.mocapId * 3 + 1] = post.y; d.mocap_pos[c.mocapId * 3 + 2] = 0;
                m.geom_contype[c.geomId] = 1; m.geom_conaffinity[c.geomId] = 1;
            } else {
                this.parkPostCollider(c);
            }
        });
        this.mujoco.mj_forward(m, d);
    }

    /** Mode A clamp: walk the joint at qpos addr `qadr` from its CURRENT angle toward `target` and
     *  stop at the FIRST angle where the arm touches a post — a hard stop, like a joint limit. We
     *  march (not bisect) because an obstacle makes a collision *band* in joint space: the far side
     *  past the post is collision-free again, and a bisection on the endpoints would teleport the
     *  joint straight through. If the start pose is already in contact we don't restrict (so you can
     *  always jog back OUT). Mutates qpos during the walk, so callers re-write the returned angle. */
    clampJointAngle(qadr: number, target: number): number {
        if (this.contactMode !== 'clamp' || !this.planner) return target;
        const m = this.mjModel, d = this.mjData, mj = this.mujoco;
        const start = d.qpos[qadr], delta = target - start;
        if (Math.abs(delta) < 1e-6) return target;
        d.qpos[qadr] = start; mj.mj_forward(m, d);
        if (this.planner.armCollidesLive(d)) return target;           // already touching → let them jog out
        const steps = Math.min(96, Math.max(4, Math.ceil(Math.abs(delta) / 0.006))); // ~0.35° resolution
        let lastFree = start;
        for (let i = 1; i <= steps; i++) {
            const a = start + delta * (i / steps);
            d.qpos[qadr] = a; mj.mj_forward(m, d);
            if (this.planner.armCollidesLive(d)) break;               // first contact → stop just before
            lastFree = a;
        }
        return lastFree;
    }

    /** Apply a primary-arm joint target under the active contact mode. Shared by the slider
     *  (setPrimaryJoint) and the link-drag (MujocoJointDrag.updateJoint):
     *   • 'physics' → set ONLY the actuator target (ctrl); mj_step + post-contact geoms resolve it,
     *     so the arm is stopped by real contact forces and never teleports into the post.
     *   • 'clamp'   → kinematic hard-stop at the post-contact boundary, then write qpos+ctrl.
     *   • 'off'     → write qpos+ctrl directly (teleport). */
    // Physics-mode jog: the commanded target per arm actuator. Each frame we creep ctrl toward it,
    // kept within LEAD of the live qpos (see advancePhysicsCtrl) so the servo can't overpower contact.
    private physicsTargets = new Map<number, number>(); // actId → commanded joint angle

    applyPrimaryJoint(qadr: number, dofadr: number, actId: number, target: number) {
        const m = this.mjModel, d = this.mjData; if (!m || !d) return;
        if (this.contactMode === 'physics') {
            // Record the target; advancePhysicsCtrl (per frame) walks ctrl toward it. We can't just set
            // ctrl=target: the servo torque is gain·(ctrl−qpos), and a far target overpowers MuJoCo's
            // soft contacts and tunnels through the post. Bounding the error per frame keeps the torque
            // small enough that the post-contact geoms hold the arm; in free space qpos chases it home.
            if (actId >= 0) this.physicsTargets.set(actId, target);
            return;
        }
        const a = this.clampJointAngle(qadr, target);
        d.qpos[qadr] = a; (d as unknown as { qvel: Float64Array }).qvel[dofadr] = 0;
        if (actId >= 0) d.ctrl[actId] = a;
        this.mujoco.mj_forward(m, d);
    }

    /** Live-jog the PRIMARY physics arm's joint (slider path). */
    setPrimaryJoint(index: number, angle: number) {
        const j = this.armJointDescs[index]; if (!j) return;
        this.applyPrimaryJoint(j.qadr, j.dofadr, j.actId, Math.min(j.hi, Math.max(j.lo, angle)));
    }

    /** FK ORACLE: base-relative transforms of every arm body (+ the TCP) at the given joint angles,
     *  computed by transiently posing the single MuJoCo arm and reading mjData, then restoring it.
     *  Lets a GHOST arm render at its OWN pose without needing its own physics body chain. */
    private bodyMatrix(bid: number, xpos: Float64Array, xquat: Float64Array): THREE.Matrix4 {
        const p = new THREE.Vector3(xpos[bid * 3], xpos[bid * 3 + 1], xpos[bid * 3 + 2]);
        const q = new THREE.Quaternion(xquat[bid * 4 + 1], xquat[bid * 4 + 2], xquat[bid * 4 + 3], xquat[bid * 4]);
        return new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1));
    }
    armPoseTransforms(joints?: number[]): { bodies: Map<number, THREE.Matrix4>; tcp: THREE.Matrix4 | null } | null {
        const m = this.mjModel, d = this.mjData; if (!m || !d || !joints) return null;
        const qadrs = this.armJointDescs.map((j) => j.qadr);
        const saved = qadrs.map((a) => d.qpos[a]);
        for (let i = 0; i < qadrs.length; i++) if (typeof joints[i] === 'number') d.qpos[qadrs[i]] = joints[i];
        this.mujoco.mj_forward(m, d);
        const xpos = d.xpos as unknown as Float64Array, xquat = d.xquat as unknown as Float64Array;
        const invBase = new THREE.Matrix4().copy(this.bodyMatrix(this.baseBodyId, xpos, xquat)).invert();
        const bodies = new Map<number, THREE.Matrix4>();
        for (const bid of this.armBodyIds) bodies.set(bid, new THREE.Matrix4().multiplyMatrices(invBase, this.bodyMatrix(bid, xpos, xquat)));
        const tcpW = this.currentTcpWorld();
        const tcp = tcpW ? new THREE.Matrix4().multiplyMatrices(invBase, tcpW) : null;
        for (let i = 0; i < qadrs.length; i++) d.qpos[qadrs[i]] = saved[i]; // restore physics state
        this.mujoco.mj_forward(m, d);
        return { bodies, tcp };
    }

    /**
     * SO-101: solve position-only numeric IK toward `target` and drive the (primary) arm there
     * via its position actuators. Returns whether the target was reachable. No-op for Franka.
     */
    moveArmTo(target: THREE.Vector3, downWeight = 0): boolean {
        if (this.isFranka || !this.numericIk || !this.mjData) return false;
        const seed = this.armJointQadr.map((a) => this.mjData!.qpos[a]);
        const { q, ok } = this.numericIk.solve(target, seed, this.mjData.qpos, downWeight);
        // Actuators 0..N-1 drive exactly the swept joints (Rotation, Pitch, Elbow, Wrist_Pitch).
        for (let j = 0; j < q.length; j++) this.mjData.ctrl[j] = q[j];
        return ok;
    }

    // ───────────────────────── SO-101 scripted grasp ─────────────────────────

    /** Current TCP (gripper site) world position. */
    private tcpWorld(): THREE.Vector3 {
        const d = this.mjData!, s = this.ikSys.gripperSiteId;
        return new THREE.Vector3(d.site_xpos[s * 3], d.site_xpos[s * 3 + 1], d.site_xpos[s * 3 + 2]);
    }

    /** Nearest DYNAMIC task block (freejoint) to a point, with its qpos/dof addresses. */
    private nearestTaskBody(p: THREE.Vector3): { bodyId: number; qposAdr: number; dofAdr: number } | null {
        const m = this.mjModel!, d = this.mjData!;
        let best = -1, bestD = Infinity;
        for (let i = 0; i < m.nbody; i++) {
            if (!getName(m, m.name_bodyadr[i]).startsWith('task')) continue;
            const jadr = m.body_jntadr[i];
            if (jadr < 0 || m.jnt_type[jadr] !== 0) continue; // 0 = free joint; skip static props
            const dx = d.xpos[i * 3] - p.x, dy = d.xpos[i * 3 + 1] - p.y, dz = d.xpos[i * 3 + 2] - p.z;
            const dd = dx * dx + dy * dy + dz * dz;
            if (dd < bestD) { bestD = dd; best = i; }
        }
        if (best < 0) return null;
        const jadr = m.body_jntadr[best];
        return { bodyId: best, qposAdr: m.jnt_qposadr[jadr], dofAdr: m.jnt_dofadr[jadr] };
    }

    /** Hold the grabbed block at a fixed offset from the TCP (and zero its velocity). */
    private pinGrabbedBlock() {
        const g = this.so101Pickup?.grab, d = this.mjData;
        if (!g || !d) return;
        const tcp = this.tcpWorld(), a = g.qposAdr;
        d.qpos[a] = tcp.x + g.offset.x;
        d.qpos[a + 1] = tcp.y + g.offset.y;
        d.qpos[a + 2] = tcp.z + g.offset.z;
        d.qpos[a + 3] = 1; d.qpos[a + 4] = 0; d.qpos[a + 5] = 0; d.qpos[a + 6] = 0;
        for (let k = 0; k < 6; k++) d.qvel[g.dofAdr + k] = 0;
    }

    /** Drop target: the teal bin (task7) top, with a sane fallback if it isn't in the scene. */
    private binDropTarget(): THREE.Vector3 {
        const m = this.mjModel!, d = this.mjData!;
        for (let i = 0; i < m.nbody; i++) {
            if (getName(m, m.name_bodyadr[i]) === 'task7') return new THREE.Vector3(d.xpos[i * 3], d.xpos[i * 3 + 1], 0.05);
        }
        return new THREE.Vector3(0.28, 0.16, 0.05);
    }

    /**
     * Advance the grasp state machine — a full pick-and-place per detected item:
     * approach → descend → close → lift → carry to the bin → lower → release.
     */
    private tickSo101Pickup(dt: number) {
        const pk = this.so101Pickup, d = this.mjData;
        if (!pk || !d) return;
        if (pk.idx >= pk.queue.length) { this.finishSo101Pickup(); return; }

        const JAW_OPEN = 1.2, JAW_CLOSED = -0.1;                  // SO-101 Jaw range [-0.17, 1.75]
        // Absolute (table-relative) heights — blocks rest on the floor, so this is robust to the
        // detected point landing on the block's top surface rather than its centre.
        const APPROACH = 0.16, GRASP = 0.05, LIFT = 0.22;
        const DUR = [1.2, 1.2, 0.6, 1.0, 1.6, 1.0, 0.5];          // seconds per phase
        const p = pk.queue[pk.idx].pos;
        const bin = this.binDropTarget();
        const DOWN_W = 0.7; // orientation weight → arm rotates to face the target + points down
        const setJaw = (v: number) => { if (this.gripperActuatorId >= 0) d.ctrl[this.gripperActuatorId] = v; };
        const at = (z: number) => new THREE.Vector3(p.x, p.y, z);
        const overBin = (z: number) => new THREE.Vector3(bin.x, bin.y, bin.z + z);

        pk.t += dt;
        switch (pk.phase) {
            case 0: this.moveArmTo(at(APPROACH), DOWN_W); setJaw(JAW_OPEN); break;     // approach above
            case 1: this.moveArmTo(at(GRASP), DOWN_W); setJaw(JAW_OPEN); break;        // descend onto it
            case 2: this.moveArmTo(at(GRASP), DOWN_W); setJaw(JAW_CLOSED); break;      // close gripper
            case 3: this.moveArmTo(at(LIFT), DOWN_W); setJaw(JAW_CLOSED); break;       // lift clear
            case 4: this.moveArmTo(overBin(0.20), DOWN_W); setJaw(JAW_CLOSED); break;  // carry over the bin
            case 5: this.moveArmTo(overBin(0.08), DOWN_W); setJaw(JAW_CLOSED); break;  // lower into the bin
            case 6: this.moveArmTo(overBin(0.08), DOWN_W); setJaw(JAW_OPEN); break;    // release
        }

        if (pk.t < DUR[pk.phase]) return;
        pk.t = 0;
        if (pk.phase === 2) {
            // Grasp closes → attach the nearest block to the gripper. Clear the ER marker either
            // way (so a missed grab doesn't leave a stale marker floating over the table).
            const nb = this.nearestTaskBody(new THREE.Vector3(p.x, p.y, p.z));
            if (nb) {
                const tcp = this.tcpWorld();
                pk.grab = {
                    qposAdr: nb.qposAdr, dofAdr: nb.dofAdr,
                    offset: new THREE.Vector3(d.xpos[nb.bodyId * 3] - tcp.x, d.xpos[nb.bodyId * 3 + 1] - tcp.y, d.xpos[nb.bodyId * 3 + 2] - tcp.z),
                };
            }
            this.renderSys.removeMarkerById(pk.queue[pk.idx].markerId);
        } else if (pk.phase === 6) {
            pk.grab = null;        // release → block drops into the bin; advance to the next item
            pk.idx++;
            pk.phase = 0;
            return;
        }
        pk.phase++;
    }

    private finishSo101Pickup() {
        const cb = this.so101Pickup?.onFinished;
        this.so101Pickup = null;
        cb?.();
    }

    private descendantBodyIds(baseBodyId: number): number[] {
        const m = this.mjModel;
        if (!m) return [];
        const parent = m.body_parentid;
        if (!parent) {
            const ids: number[] = [];
            for (let i = 0; i < m.nbody; i++) {
                const name = getName(m, m.name_bodyadr[i]);
                if (name !== 'world' && name !== 'table' && !name.startsWith('task')) ids.push(i);
            }
            return ids;
        }
        const ids: number[] = [];
        for (let i = 0; i < m.nbody; i++) {
            let cursor = i;
            while (cursor > 0) {
                if (cursor === baseBodyId) {
                    ids.push(i);
                    break;
                }
                cursor = parent[cursor];
            }
        }
        return ids;
    }

    /** SO-101 default rest pose: a user-recorded pose (localStorage) overrides the factory keyframe.
     *  Order matches the actuators: Rotation,Pitch,Elbow,Wrist_Pitch,Wrist_Roll,Jaw (radians). */
    static readonly SO101_FACTORY_REST = [0, -1.57, 1.57, 1.57, -1.57, 0];
    private so101RestPose(): number[] {
        try {
            const saved = JSON.parse(localStorage.getItem('so101-rest-qpos') || 'null');
            if (Array.isArray(saved) && saved.length === MujocoSim.SO101_FACTORY_REST.length && saved.every((v) => typeof v === 'number')) return saved;
        } catch { /* fall through to factory */ }
        return MujocoSim.SO101_FACTORY_REST;
    }

    /** Read the arm's current joint angles (one per actuator) — for recording a custom rest pose. */
    getArmJointPositions(): number[] {
        if (!this.mjModel || !this.mjData || this.isFranka) return [];
        const vals: number[] = [];
        for (let i = 0; i < this.mjModel.nu; i++) {
            const jointId = this.mjModel.actuator_trnid[2 * i];
            vals.push(jointId >= 0 ? this.mjData.qpos[this.mjModel.jnt_qposadr[jointId]] : 0);
        }
        return vals;
    }

    /** Persist the CURRENT jogged pose as the new default rest pose (consumed on next reset/load). */
    saveRestPose(): number[] {
        const vals = this.getArmJointPositions();
        if (vals.length) localStorage.setItem('so101-rest-qpos', JSON.stringify(vals));
        return vals;
    }
    clearRestPose() { localStorage.removeItem('so101-rest-qpos'); }

    private setInitialPose() {
        if (!this.mjModel || !this.mjData) return;
        // Franka home pose, or the SO-ARM100 rest pose (recorded override or factory keyframe).
        const initVals = this.isFranka
            ? [1.707, -1.754, 0.003, -2.702, 0.003, 0.951, 2.490, 0.000]
            : this.so101RestPose();

        for (let i = 0; i < Math.min(initVals.length, this.mjModel.nu); i++) {
            this.mjData.ctrl[i] = initVals[i];
            // Seed qpos too, so the arm STARTS in the home pose (not just driven toward it).
            // actuator_trnid[2*i] is the actuator's joint id for joint transmission; the old
            // `[2*i+1] === 1` guard was always false (that slot is -1), so qpos was never set —
            // which left the ghost-arm template snapshot in the collapsed/limp zero pose.
            const jointId = this.mjModel.actuator_trnid[2 * i];
            if (jointId >= 0 && jointId < this.mjModel.njnt) {
                this.mjData.qpos[this.mjModel.jnt_qposadr[jointId]] = initVals[i];
            }
        }
    }

    private randomizeCubes() {
        if (!this.mjModel || !this.mjData) return;
        const positions: Array<{x: number, y: number}> = [];
        
        for (let i = 0; i < this.mjModel.nbody; i++) {
            const name = getName(this.mjModel, this.mjModel.name_bodyadr[i]);
            if (name.startsWith('cube')) {
                let x = 0;
                let y = 0;
                let valid = false;
                let attempts = 0;
                while (!valid && attempts < 100) {
                    const minR = 0.35;
                    const maxR = 0.8;
                    const r = Math.sqrt(Math.random() * (maxR*maxR - minR*minR) + minR*minR);
                    const theta = Math.random() * 2 * Math.PI;
                    x = r * Math.cos(theta);
                    y = r * Math.sin(theta);
                    valid = true;
                    const distStack = Math.sqrt((x - 0.6)**2 + (y - 0)**2);
                    if (distStack < 0.35) valid = false;
                    if (valid) {
                        for (const p of positions) {
                            if ((p.x - x)**2 + (p.y - y)**2 < 0.004) { valid = false; break; }
                        }
                    }
                    attempts++;
                }
                if (valid) {
                    positions.push({x, y});
                    
                    // Assuming body_jntadr exists in the model wrapper or bindings
                    // Standard MuJoCo has body_jntadr.
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const jntIdVal = (this.mjModel as any).body_jntadr[i];
                    if (jntIdVal >= 0) {
                        const qp = this.mjModel.jnt_qposadr[jntIdVal];
                        this.mjData.qpos[qp] = x;
                        this.mjData.qpos[qp + 1] = y;
                        this.mjData.qpos[qp + 2] = 0.02;
                        // Orientation (Identity)
                        this.mjData.qpos[qp + 3] = 1;
                        this.mjData.qpos[qp + 4] = 0;
                        this.mjData.qpos[qp + 5] = 0;
                        this.mjData.qpos[qp + 6] = 0;
                    }
                }
            }
        }
    }

    private startLoop() {
        if (this.frameId) cancelAnimationFrame(this.frameId);

        const loop = () => {
            if (!this.mjModel || !this.mjData) {
                 this.frameId = requestAnimationFrame(loop);
                 return;
            }

            // Real frame delta (s), clamped so a backgrounded tab can't fast-forward scripts.
            const nowMs = performance.now();
            const frameDt = this.lastLoopMs ? Math.min((nowMs - this.lastLoopMs) / 1000, 0.05) : 1 / 60;
            this.lastLoopMs = nowMs;

            this.dragStateManager.update();
            if (this.draggedBodyId() !== null) this.mjData.xfrc_applied.fill(0);
            if (this.dragStateManager.active && this.dragStateManager.physicsObject) {
                this.applyDragForce();
            }
            
            if (this.gizmoAnim.active) {
                const now = performance.now();
                const elapsed = now - this.gizmoAnim.startTime;
                const t = Math.min(elapsed / this.gizmoAnim.duration, 1.0);
                const ease = 1 - Math.pow(1 - t, 3);
                
                this.ikSys.target.position.lerpVectors(this.gizmoAnim.startPos, this.gizmoAnim.endPos, ease);
                this.ikSys.target.quaternion.slerpQuaternions(this.gizmoAnim.startRot, this.gizmoAnim.endRot, ease);
                
                if (t >= 1.0) {
                    this.gizmoAnim.active = false;
                }
            }

            if (!this.paused) {
                // Analytical IK + scripted pickup are Franka-only. The SO-101 twin just holds
                // its pose via the position actuators (reachability is computed off-screen).
                if (this.isFranka) {
                    if (this.sequenceAnimator.running) {
                        this.sequenceAnimator.update((1/60) * this.speedMultiplier, this.ikSys.target, this.mjData, this.gripperActuatorId, this.ikSys);
                        this.setIkEnabled(false);
                    } else {
                         this.syncIkState();
                         this.ikSys.update(this.mjModel, this.mjData);
                    }
                } else if (this.so101Pickup) {
                    // Drive the grasp phases (sets arm ctrl + jaw) before integrating physics.
                    // Wall-clock delta → phase timing is identical at 60 / 120 / 144 Hz.
                    this.tickSo101Pickup(frameDt * this.speedMultiplier);
                }

                const startSimTime = this.mjData.time;
                // Allow simulation to run faster than real-time based on speedMultiplier
                while (this.mjData.time - startSimTime < (1.0 / 60.0) * this.speedMultiplier) {
                    this.advancePhysicsCtrl(); // Mode B: creep arm ctrl toward target (bounded for contact)
                    this.mujoco.mj_step(this.mjModel, this.mjData);
                }

                // Keep the grabbed block pinned to the gripper (kinematic grasp — position-only IK
                // can't guarantee a force-closure grip, so we ride the block on the TCP during lift).
                if (this.so101Pickup?.grab) {
                    this.pinGrabbedBlock();
                    this.mujoco.mj_forward(this.mjModel, this.mjData); // refresh xpos for rendering
                }
            }

            this.renderSys.update(this.mjData, this.renderSys.contactMarkers.visible);
            this.frameId = requestAnimationFrame(loop);
        };
        this.frameId = requestAnimationFrame(loop);
    }

    private draggedBodyId(): number | null { 
        return this.dragStateManager.active && this.dragStateManager.physicsObject ? this.dragStateManager.physicsObject.userData.bodyID : null; 
    }

    private applyDragForce() {
        if (!this.mjData) return;
        const bodyId = this.draggedBodyId()!;
        const force = new THREE.Vector3().subVectors(this.dragStateManager.currentWorld, this.dragStateManager.worldHit).multiplyScalar(1.5);
        if (force.lengthSq() > 25) force.setLength(5.0); 
        
        const bodyPos = new THREE.Vector3().fromArray(this.mjData.xpos, bodyId * 3);
        const leverArm = new THREE.Vector3().subVectors(this.dragStateManager.worldHit, bodyPos);
        const torque = leverArm.cross(force);

        this.mjData.xfrc_applied.set([force.x, force.y, force.z, torque.x, torque.y, torque.z], bodyId * 6);
    }
    
    private syncIkState() {
        const shouldCalculate = this.userIkEnabled;
        const shouldShowGizmo = this.userIkEnabled && !this.gizmoAnim.active && !this.sequenceAnimator.running; 
        
        this.ikSys.setCalculating(shouldCalculate);
        this.ikSys.setGizmoVisible(shouldShowGizmo);
        
        if (this.sequenceAnimator.running) {
            this.ikSys.setTargetVisible(true);
        } else if(shouldCalculate) {
            this.ikSys.setTargetVisible(true);
        }
    }

    moveIkTargetTo(pos: THREE.Vector3, duration = 0) {
        if (!this.userIkEnabled) {
            this.setIkEnabled(true);
        }
        
        const targetPos = new THREE.Vector3(pos.x, pos.y, pos.z + 0.05);
        const targetRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, 0, 0));

        if (duration > 0) {
            this.gizmoAnim.active = true;
            this.gizmoAnim.startPos.copy(this.ikSys.target.position);
            this.gizmoAnim.endPos.copy(targetPos);
            this.gizmoAnim.startRot.copy(this.ikSys.target.quaternion);
            this.gizmoAnim.endRot.copy(targetRot);
            this.gizmoAnim.startTime = performance.now();
            this.gizmoAnim.duration = duration;
        } else {
            this.gizmoAnim.active = false;
            this.ikSys.target.position.copy(targetPos);
            this.ikSys.target.quaternion.copy(targetRot);
        }
    }

    pickupItems(positions: THREE.Vector3[], markerIds: number[], onFinished?: () => void) {
        if (!this.isFranka) {
            // SO-101: numeric-IK grasp choreography (approach → descend → close → lift → release).
            if (this.so101Pickup) return; // already running — ignore re-entrant calls (button = speed)
            if (!this.numericIk || !this.mjData || positions.length === 0) { onFinished?.(); return; }
            this.so101Pickup = {
                queue: positions.map((p, i) => ({ pos: p.clone(), markerId: markerIds[i] })),
                idx: 0, phase: 0, t: 0, onFinished, grab: null,
            };
            return;
        }
        if (this.sequenceAnimator && this.mjData) {
            this.ikSys.syncToSite(this.mjData);
            this.sequenceAnimator.start(
                this.ikSys.target, 
                this.mjData, 
                this.ikSys, 
                { positions, markerIds }, 
                (markerId) => {
                    this.renderSys.removeMarkerById(markerId);
                },
                onFinished
            );
            this.setIkEnabled(false);
        }
    }

    reset() {
        if (!this.mjModel || !this.mjData) return;
        this.renderSys.clearErMarkers();
        this.gizmoAnim.active = false;
        this.so101Pickup = null;
        this.sequenceAnimator.reset();
        this.mujoco.mj_resetData(this.mjModel, this.mjData);
        this.setInitialPose();
        this.randomizeCubes(); 
        this.mujoco.mj_forward(this.mjModel, this.mjData); 
        this.ikSys.syncToSite(this.mjData);
        
        this.ikSys.target.quaternion.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
        this.ikSys.target.position.set(0, 0, 0.45);
        this.firstIkEnable = true;
    }
    
    togglePause() { return this.paused = !this.paused; }
    
    setIkEnabled(enabled: boolean) {
        this.userIkEnabled = enabled;
        this.syncIkState();
        if (enabled && this.mjData && !this.gizmoAnim.active && !this.sequenceAnimator.running) {
            if (this.firstIkEnable) {
                this.ikSys.target.quaternion.setFromEuler(new THREE.Euler(Math.PI, 0, 0));
                this.ikSys.target.position.set(0, 0, 0.45);
                this.firstIkEnable = false;
            } else {
                this.ikSys.syncToSite(this.mjData);
            }
        }
    }
    
    setSpeedMultiplier(speed: number) {
        this.speedMultiplier = speed;
    }
    
    getGizmoStats() { return this.ikSys.calculating && this.ikSys.target ? { pos: this.ikSys.target.position.clone(), rot: new THREE.Euler().setFromQuaternion(this.ikSys.target.quaternion) } : null; }
    
    dispose() {
        if (this.frameId) cancelAnimationFrame(this.frameId);
        if (this.planner) { this.planner.dispose(); this.planner = null; }
        if (this.numericIk) { this.numericIk.dispose(); this.numericIk = null; }
        this.dragStateManager.dispose();
        this.selectionManager.dispose(); 
        this.renderSys.dispose(); 
        this.ikSys.dispose();
        if (this.mjvOption) this.mjvOption.delete(); 
        if (this.mjModel) this.mjModel.delete(); 
        if (this.mjData) this.mjData.delete();
        try { this.mujoco.FS.unmount('/working'); } catch (e) { /* ignore */ }
    }
}
