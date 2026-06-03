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
    /** Fired after a (re)load creates a new planner, so React can re-apply its state. */
    onSceneReload: (() => void) | null = null;
    private robotId = '';
    private sceneFile = 'scene.xml';
    private basePose: BasePose | null = null;
    private workcellConfig: WorkcellConfig = { ...DEFAULT_WORKCELL_CONFIG };
    private armInstances: ArmInstance[] = [];
    private baseBodyId = 0;
    private armBodyIds: number[] = [];

    private userIkEnabled = false;
    private firstIkEnable = true; // Track first enable to enforce default rotation

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
        this.robotId = robotId;
        this.sceneFile = sceneFile;
        if (basePose !== undefined) this.basePose = basePose;
        if (workcellConfig !== undefined) this.workcellConfig = { ...workcellConfig };
        this.isFranka = robotId.includes('franka');

        // Tear down any previous model/data/planner (also supports base-relocation reloads).
        if (this.frameId) { cancelAnimationFrame(this.frameId); this.frameId = null; }
        if (this.planner) { this.planner.dispose(); this.planner = null; this.renderSys.extraPipHelpers = []; }
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
        for (let i = 0; i < this.mjModel.nu; i++) {
            const an = getName(this.mjModel, this.mjModel.name_actuatoradr[i]);
            if (an.toLowerCase().includes('gripper') || an === 'Jaw') { this.gripperActuatorId = i; break; }
        }

        this.setInitialPose();
        this.mujoco.mj_forward(this.mjModel, this.mjData);
        this.renderSys.initScene(this.mjModel);
        this.renderSys.syncBodiesFromData(this.mjData);

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
        this.renderSys.buildPlanningArmTemplate(this.armBodyIds, this.baseBodyId);
        this.renderSys.setPlanningArmInstances(this.armInstances);
        this.planner.setArms(this.armInstances, this.basePose?.yaw ?? 0);
        this.planner.computeReachability();
    }

    /** Reload the model with the arm base moved/rotated — the "drag the mount" path. */
    async relocateBase(x: number, y: number, yaw = this.basePose?.yaw ?? 0) {
        if (this.isFranka) return;
        this.basePose = { x, y, yaw };
        await this.init(this.robotId, this.sceneFile);
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

    setArmInstances(instances: ArmInstance[]) {
        this.armInstances = instances.map((arm) => ({ ...arm }));
        this.renderSys.setPlanningArmInstances(this.armInstances);
        // Ghost arms moving doesn't need a recompute — just re-transform the reach outlines.
        this.planner?.setArms(this.armInstances, this.basePose?.yaw ?? 0);
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

    private setInitialPose() {
        if (!this.mjModel || !this.mjData) return;
        // Franka home pose, or the SO-ARM100 'home' keyframe (Rotation,Pitch,Elbow,Wrist_Pitch,Wrist_Roll,Jaw).
        const initVals = this.isFranka
            ? [1.707, -1.754, 0.003, -2.702, 0.003, 0.951, 2.490, 0.000]
            : [0, -1.57, 1.57, 1.57, -1.57, 0];

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
                }

                const startSimTime = this.mjData.time;
                // Allow simulation to run faster than real-time based on speedMultiplier
                while (this.mjData.time - startSimTime < (1.0 / 60.0) * this.speedMultiplier) {
                    this.mujoco.mj_step(this.mjModel, this.mjData);
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
        if (!this.isFranka) return; // scripted pickup uses Franka analytical IK
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
