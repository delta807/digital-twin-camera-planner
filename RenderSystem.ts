/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { DragStateManager } from './DragStateManager';
import { GeomBuilder } from './rendering/GeomBuilder';
import { ArmInstance, MujocoData, MujocoModel, MujocoModule } from './types';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { WorkspaceCameraRig } from './WorkspaceCameraRig';
import { BaseBuilder } from './BaseBuilder';
import { WristCamera } from './WristCamera';
import { MeasureTool } from './MeasureTool';
import { SelectionController } from './SelectionController';
import { getName } from './utils/StringUtils';

/**
 * RenderSystem
 * RESPONSIBILITY: Managing the 3D Scene Graph with a light spatial aesthetic.
 */
export class RenderSystem {
    scene: THREE.Scene;
    renderer: THREE.WebGLRenderer;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    cameraRig: WorkspaceCameraRig;
    /** One wrist feed per arm (primary + planning ghosts), keyed by armId. Lazily created. */
    wristCameras = new Map<string, WristCamera>();
    wristEnabled = false; // master toggle for all wrist feeds
    gripperSiteId = -1; // set by MujocoSim so the wrist cam can track the end-effector
    private wristMount = { back: 0.035, up: 0.055, reach: 0.05, fov: 58, aspect: 16 / 9 };
    private readonly tmpVec = new THREE.Vector3();
    baseBuilder: BaseBuilder;
    measureTool!: MeasureTool;
    selection!: SelectionController;
    private cssRenderer!: CSS2DRenderer;
    private originAxes!: THREE.Group;
    /** Extra overlays (e.g. reachability heatmaps) to hide from the sensor-camera PIP. */
    extraPipHelpers: THREE.Object3D[] = [];
    
    simGroup: THREE.Group;   
    bodies: Array<THREE.Group> = []; 
    
    ambientLight!: THREE.AmbientLight;
    customLights: { light: THREE.PointLight; helper: THREE.Mesh; control: TransformControls; name: string; baseIntensity: number; }[] = [];
    contactMarkers!: THREE.InstancedMesh; 
    
    erGroup: THREE.Group;
    planningArmsGroup = new THREE.Group();
    private planningArmTemplate: THREE.Group | null = null;
    private raycaster = new THREE.Raycaster();

    private dummy = new THREE.Object3D(); 
    private container: HTMLElement;
    private geomBuilder: GeomBuilder;
    private grid!: THREE.GridHelper;

    private isAnimatingCamera = false;
    private camAnimStartPos = new THREE.Vector3();
    private camAnimStartRot = new THREE.Quaternion();
    private camAnimStartTarget = new THREE.Vector3();
    private camAnimTargetPos = new THREE.Vector3();
    private camAnimTargetRot = new THREE.Quaternion();
    private camAnimEndTarget = new THREE.Vector3();
    private camAnimStartTime = 0;
    private camAnimDuration = 0;

    constructor(container: HTMLElement, mujoco: MujocoModule) {
        this.container = container;
        this.geomBuilder = new GeomBuilder(mujoco);
        
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0xdbeafe); 
        
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true; 
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        container.appendChild(this.renderer.domElement);

        // Tight near/far (the whole workcell is < 2 m) — a 10000:1 ratio crushed depth precision
        // near the ground and amplified Z-fighting/flicker on the table + overlays.
        this.camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.05, 50);
        this.camera.up.set(0, 0, 1); 
        this.camera.position.set(2, -1.5, 2.5);
        this.camera.lookAt(0, 0, 0);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true; 
        this.controls.dampingFactor = 0.1;
        this.controls.minDistance = 0.1; 
        this.controls.maxDistance = 100;
        this.controls.target.set(0, 0, 0);

        this.simGroup = new THREE.Group();
        this.scene.add(this.simGroup);

        this.erGroup = new THREE.Group();
        this.scene.add(this.erGroup);

        this.scene.add(this.planningArmsGroup);

        this.initContactMarkers();
        this.initGrid();

        // Placeable "sensor" camera planner (frustum / PIP / footprint / coverage).
        this.cameraRig = new WorkspaceCameraRig(this.scene, this.camera, this.renderer.domElement, this.controls);
        this.baseBuilder = new BaseBuilder(this.scene);
        this.initCoordinateSystem();

        // CSS2D overlay for crisp measurement labels (sits over the canvas, click-through).
        this.cssRenderer = new CSS2DRenderer();
        this.cssRenderer.setSize(container.clientWidth, container.clientHeight);
        this.cssRenderer.domElement.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
        container.appendChild(this.cssRenderer.domElement);
        this.measureTool = new MeasureTool(this.scene, this.camera, this.renderer.domElement,
            () => [this.simGroup, this.baseBuilder.group]);

        // Click-to-select (outline + post drag-gizmo). Selectables: task objects + the camera post.
        this.selection = new SelectionController(
            this.scene, this.camera, this.renderer.domElement, this.controls,
            () => [this.simGroup, this.baseBuilder.group, this.cameraRig.gizmo, this.planningArmsGroup],
            () => this.baseBuilder.postAxis);

        window.addEventListener('resize', this.onResize);
    }

    private initGrid() {
        if (this.grid) this.scene.remove(this.grid);
        // Halved grid size to 5x5 as requested
        this.grid = new THREE.GridHelper(5, 50, 0xbfdbfe, 0xeff6ff);
        this.grid.rotation.x = Math.PI / 2;
        this.grid.position.z = -0.001;
        this.scene.add(this.grid);
    }

    setDarkMode(enabled: boolean) {
        if (enabled) {
            this.scene.background = new THREE.Color(0x020617);
            this.scene.remove(this.grid);
            this.grid = new THREE.GridHelper(5, 50, 0x1e293b, 0x0f172a);
            this.grid.rotation.x = Math.PI / 2;
            this.grid.position.z = -0.001;
            this.scene.add(this.grid);
        } else {
            this.scene.background = new THREE.Color(0xdbeafe);
            this.scene.remove(this.grid);
            this.grid = new THREE.GridHelper(5, 50, 0xbfdbfe, 0xeff6ff);
            this.grid.rotation.x = Math.PI / 2;
            this.grid.position.z = -0.001;
            this.scene.add(this.grid);
        }
    }

    initScene(mjModel: MujocoModel) {
        this.bodies.forEach(b => this.simGroup.remove(b));
        this.bodies = [];
        this.planningArmTemplate = null;
        this.planningArmsGroup.clear();
        
        for (let i = 0; i < mjModel.nbody; i++) {
            const grp = new THREE.Group();
            grp.userData.bodyID = i;
            // Tag movable demo props so the SelectionController can pick them (and ignore the
            // arm links + worldbody floor). Names come from RobotLoader: task*/cube*/tray.
            const nm = getName(mjModel, mjModel.name_bodyadr[i]);
            grp.userData.bodyName = nm;
            if (/^(task|cube|tray)/.test(nm)) grp.userData.selectable = 'object';
            // Everything else that's a real robot link (not the worldbody/floor) → the arm.
            else if (i > 0 && nm !== 'world') grp.userData.selectable = 'arm';
            this.bodies.push(grp);
            this.simGroup.add(grp);
        }

        for (let g = 0; g < mjModel.ngeom; g++) {
            const mesh = this.geomBuilder.create(mjModel, g);
            if (mesh) {
                this.bodies[mjModel.geom_bodyid[g]].add(mesh);
            }
        }
    }

    initLights(dragStateManager: DragStateManager) {
        const main = new THREE.DirectionalLight(0xffffff, 1.2); 
        main.position.set(1, 2, 5); 
        main.castShadow = true; 
        main.shadow.mapSize.set(2048, 2048); 
        main.shadow.bias = -0.0001; 
        this.simGroup.add(main);
        
        const fill = new THREE.DirectionalLight(0xffffff, 0.8); 
        fill.position.set(-1, -1, 3); 
        this.simGroup.add(fill);
        
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.7); 
        this.simGroup.add(this.ambientLight);
    }

    update(mjData: MujocoData, showContacts: boolean) {
        if (this.isAnimatingCamera) {
            const now = performance.now();
            const progress = Math.min((now - this.camAnimStartTime) / this.camAnimDuration, 1.0);
            const ease = progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
            this.camera.position.lerpVectors(this.camAnimStartPos, this.camAnimTargetPos, ease);
            this.camera.quaternion.slerpQuaternions(this.camAnimStartRot, this.camAnimTargetRot, ease);
            this.controls.target.lerpVectors(this.camAnimStartTarget, this.camAnimEndTarget, ease);
            if (progress >= 1.0) {
                this.isAnimatingCamera = false;
                this.camera.position.copy(this.camAnimTargetPos);
                this.camera.quaternion.copy(this.camAnimTargetRot);
                this.controls.target.copy(this.camAnimEndTarget);
                this.controls.update();
            }
        } else {
            this.controls.update(); 
        }
        
        this.syncBodiesFromData(mjData);
        this.updateContacts(mjData, showContacts);
        
        const time = performance.now() / 1000;
        this.erGroup.children.forEach((child, i) => {
            child.position.z = child.userData.baseZ + Math.sin(time * 3 + i) * 0.05;
        });

        this.selection.update();
        this.renderer.render(this.scene, this.camera);

        // Sensor-camera overlays + PIP. Runs after the main view so its helper-hiding
        // (for clean PIP "footage") never affects what the user sees in the main viewport.
        // Hide the camera post in every PIP: the real D435i is mounted ON the post, so its footage
        // never contains the post — the sim PIP should match that to represent reality faithfully.
        const pipHide = [this.grid, this.erGroup, this.planningArmsGroup, this.originAxes, this.measureTool.group, this.selection.group, ...this.baseBuilder.postMeshes, ...this.extraPipHelpers];
        this.cameraRig.update(this.simGroup, pipHide);

        // Wrist-cam footage: one feed per arm. Each tracks its own end-effector + renders its PIP.
        if (this.wristEnabled && this.gripperSiteId >= 0 && this.wristCameras.size > 0) {
            // Base wrist hide = overlays + the floating D435i rig + grid/axes/etc — but NOT the whole
            // planningArmsGroup (the overhead D435i hides it; the wrist cams must NOT, or a ghost arm's
            // own wrist cam can't see its own gripper). We hide the OTHER ghosts per-camera below.
            const wristBase = [this.grid, this.erGroup, this.originAxes, this.measureTool.group,
                this.selection.group, ...this.baseBuilder.postMeshes, ...this.extraPipHelpers, ...this.cameraRig.overlays];
            const ghosts = this.planningArmsGroup.children;
            this.wristCameras.forEach((cam, armId) => {
                // A planning ghost with this id → track its TCP marker; otherwise it's the primary
                // (not in planningArmsGroup) → fall through to the live MuJoCo TCP.
                const ownGhost = ghosts.find((c) => c.userData.armId === armId);
                let marker: THREE.Object3D | undefined;
                if (ownGhost) ownGhost.traverse((o) => { if (!marker && o.userData?.isTcp) marker = o; });
                if (marker) {
                    marker.updateWorldMatrix(true, false);
                    cam.trackFromMatrix(marker.matrixWorld);
                } else {
                    const s = this.gripperSiteId;
                    cam.track(this.tmpVec.fromArray(mjData.site_xpos as unknown as number[], s * 3), mjData.site_xmat as unknown as ArrayLike<number>, s * 9);
                }
                // Keep THIS cam's own ghost visible (so it sees its gripper); hide every other ghost.
                const hide = ownGhost ? [...wristBase, ...ghosts.filter((g) => g !== ownGhost)] : [...wristBase, ...ghosts];
                cam.renderPip(hide);
            });
        }

        // Measurement labels (DOM overlay).
        this.cssRenderer.render(this.scene, this.camera);
    }

    /** Origin axis triad at the table center (X red, Y green, Z blue) + an origin marker dot. */
    private initCoordinateSystem() {
        this.originAxes = new THREE.Group();
        this.originAxes.name = 'OriginAxes';
        const axes = new THREE.AxesHelper(0.18);
        (axes.material as THREE.Material).depthTest = false;
        axes.renderOrder = 998;
        const dot = new THREE.Mesh(
            new THREE.SphereGeometry(0.008, 12, 12),
            new THREE.MeshBasicMaterial({ color: 0x111827, depthTest: false }),
        );
        dot.renderOrder = 999;
        this.originAxes.add(axes, dot);
        this.scene.add(this.originAxes);
    }

    setAxesVisible(visible: boolean) {
        if (this.originAxes) this.originAxes.visible = visible;
    }

    syncBodiesFromData(mjData: MujocoData) {
        for (let i = 0; i < this.bodies.length; i++) {
            if (this.bodies[i]) {
                this.bodies[i].position.set(mjData.xpos[i * 3], mjData.xpos[i * 3 + 1], mjData.xpos[i * 3 + 2]);
                this.bodies[i].quaternion.set(mjData.xquat[i * 4 + 1], mjData.xquat[i * 4 + 2], mjData.xquat[i * 4 + 3], mjData.xquat[i * 4]);
                this.bodies[i].updateMatrixWorld();
            }
        }
    }

    buildPlanningArmTemplate(bodyIds: number[], baseBodyId: number, tcpWorld?: THREE.Matrix4) {
        const base = this.bodies[baseBodyId];
        if (!base) return;
        base.updateMatrixWorld(true);
        const invBase = new THREE.Matrix4().copy(base.matrixWorld).invert();
        const template = new THREE.Group();
        // TCP marker in base-local space → each ghost clone carries it so its wrist cam can track.
        if (tcpWorld) {
            const marker = new THREE.Object3D();
            marker.applyMatrix4(new THREE.Matrix4().multiplyMatrices(invBase, tcpWorld));
            marker.userData.isTcp = true;
            template.add(marker);
        }
        for (const bodyId of bodyIds) {
            const body = this.bodies[bodyId];
            if (!body || body.children.length === 0) continue;
            body.updateMatrixWorld(true);
            const local = new THREE.Matrix4().multiplyMatrices(invBase, body.matrixWorld);
            const bodyClone = new THREE.Group();
            bodyClone.applyMatrix4(local);
            for (const child of body.children) {
                const mesh = child as THREE.Mesh;
                if (!mesh.isMesh) continue;
                const clone = mesh.clone();
                if (Array.isArray(mesh.material)) {
                    clone.material = mesh.material.map((m) => this.clonePlanningMaterial(m));
                } else {
                    clone.material = this.clonePlanningMaterial(mesh.material);
                }
                bodyClone.add(clone);
            }
            template.add(bodyClone);
        }
        this.planningArmTemplate = template;
    }

    setPlanningArmInstances(instances: ArmInstance[]) {
        this.planningArmsGroup.clear();
        if (!this.planningArmTemplate) return;
        for (const instance of instances) {
            if (instance.primary) continue;
            const clone = this.planningArmTemplate.clone(true);
            clone.position.set(instance.x, instance.y, 0);
            clone.rotation.z = instance.yaw;
            clone.userData.armId = instance.id;
            clone.userData.selectable = 'arm'; // pickable + carries its armId for per-arm outline
            this.planningArmsGroup.add(clone);
        }
    }

    private clonePlanningMaterial(material: THREE.Material): THREE.Material {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = Math.min(0.82, clone.opacity);
        // Don't let ghosts inherit the jog hover-highlight: if the template is rebuilt while a
        // primary link is still highlighted (drag end fires before unhover), its emissive would
        // leak into the clone and tint the ghost pink.
        const std = clone as THREE.MeshStandardMaterial;
        if (std.emissive) std.emissive.setHex(0x000000);
        return clone;
    }

    private initContactMarkers() {
        this.contactMarkers = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.02, 8, 8), 
            new THREE.MeshStandardMaterial({ color: 0x4f46e5, emissive: 0x312e81, roughness: 0.5 }), 
            500 
        );
        this.contactMarkers.count = 0; 
        this.contactMarkers.visible = false; 
        this.simGroup.add(this.contactMarkers);
    }

    private updateContacts(mjData: MujocoData, show: boolean) {
        if (!show || !mjData.ncon) { this.contactMarkers.count = 0; return; }
        const count = Math.min(mjData.ncon, this.contactMarkers.instanceMatrix.count);
        this.contactMarkers.count = count; 
        this.contactMarkers.visible = count > 0;
        for (let i = 0; i < count; i++) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const con = (mjData.contact as any)[i] || (mjData.contact as any).get(i);
            if (con?.pos) { 
                this.dummy.position.set(con.pos[0], con.pos[1], con.pos[2]); 
                this.dummy.updateMatrix(); 
                this.contactMarkers.setMatrixAt(i, this.dummy.matrix); 
            }
        }
        this.contactMarkers.instanceMatrix.needsUpdate = true; 
    }

    moveCameraTo(position: THREE.Vector3, target: THREE.Vector3, durationMs: number): Promise<void> {
        return new Promise((resolve) => {
            this.isAnimatingCamera = true;
            this.camAnimStartTime = performance.now();
            this.camAnimDuration = durationMs;
            this.camAnimStartPos.copy(this.camera.position);
            this.camAnimStartRot.copy(this.camera.quaternion);
            this.camAnimStartTarget.copy(this.controls.target);
            this.camAnimTargetPos.copy(position);
            this.camAnimEndTarget.copy(target);
            const dummyCam = this.camera.clone();
            dummyCam.position.copy(position);
            dummyCam.lookAt(target);
            this.camAnimTargetRot.copy(dummyCam.quaternion);
            setTimeout(resolve, durationMs);
        });
    }

    getCameraState() {
        return { position: this.camera.position.clone(), target: this.controls.target.clone() };
    }

    /**
     * Frame an object (or the whole workcell) in view — OrcaSlicer "reset view" / FreeCAD
     * fit-all. Computes the bounding sphere and places the camera so it fills ~70% of the
     * narrower FOV. `keepDirection` keeps the current view angle (zoom-to-selection); otherwise
     * snaps to the default Z-up isometric. Returns the animation promise.
     */
    frameView(object?: THREE.Object3D | null, keepDirection = false, durationMs = 320): Promise<void> {
        const box = new THREE.Box3();
        if (object) {
            box.setFromObject(object);
        } else {
            // Whole scene: robot + task objects + worktop, but EXCLUDE the worldbody floor plane
            // (bodyID 0 — an effectively-infinite MuJoCo plane that would blow up the bounds) and
            // any other absurdly large mesh (lights have no geometry and are skipped automatically).
            this.simGroup.updateMatrixWorld(true);
            const tmp = new THREE.Box3();
            this.simGroup.traverse((o) => {
                const m = o as THREE.Mesh;
                if (!m.isMesh || !m.visible || !m.geometry) return;
                for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p.userData?.bodyID === 0) return;
                tmp.setFromObject(m);
                if (tmp.isEmpty()) return;
                const s = tmp.getSize(new THREE.Vector3());
                if (s.x > 5 || s.y > 5 || s.z > 5) return; // skip huge planes/backdrops
                box.union(tmp);
            });
            const baseBox = new THREE.Box3().setFromObject(this.baseBuilder.group);
            if (!baseBox.isEmpty()) box.union(baseBox);
        }
        if (box.isEmpty()) return Promise.resolve();

        const sphere = box.getBoundingSphere(new THREE.Sphere());
        const r = Math.max(sphere.radius, 0.05);
        const vFov = THREE.MathUtils.degToRad(this.camera.fov);
        const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
        const dist = Math.max(r / Math.sin(vFov / 2), r / Math.sin(hFov / 2)) / 0.7;

        // Keep the current view angle for "frame selection"; else default Z-up iso (front-right-top).
        const dir = keepDirection
            ? this.camera.position.clone().sub(this.controls.target).normalize()
            : new THREE.Vector3(1, -1, 0.85).normalize();
        if (dir.lengthSq() < 1e-6) dir.set(1, -1, 0.85).normalize();

        const target = sphere.center.clone();
        const position = target.clone().addScaledVector(dir, dist);
        return this.moveCameraTo(position, target, durationMs);
    }

    /**
     * Captures a snapshot of the current renderer state.
     * @param width Desired width of snapshot
     * @param height Desired height of snapshot
     * @param mimeType Image format (e.g. 'image/png' or 'image/jpeg')
     */
    getCanvasSnapshot(width?: number, height?: number, mimeType = 'image/jpeg'): string {
        if (width && height) {
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = width;
            tempCanvas.height = height;
            const ctx = tempCanvas.getContext('2d');
            if (ctx) {
                ctx.drawImage(this.renderer.domElement, 0, 0, width, height);
                return tempCanvas.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.8 : undefined);
            }
        }
        return this.renderer.domElement.toDataURL(mimeType, mimeType === 'image/jpeg' ? 0.8 : undefined);
    }

    project2DTo3D(x: number, y: number, cameraPos: THREE.Vector3, lookAt: THREE.Vector3): { point: THREE.Vector3, bodyId: number } | null {
        const virtCam = this.camera.clone();
        virtCam.position.copy(cameraPos);
        virtCam.lookAt(lookAt);
        virtCam.updateMatrixWorld();
        virtCam.updateProjectionMatrix(); 
        const ndc = new THREE.Vector2((x / 1000) * 2 - 1, -(y / 1000) * 2 + 1);
        this.raycaster.setFromCamera(ndc, virtCam);
        const objects: THREE.Object3D[] = [];
        this.simGroup.traverse((c) => { if ((c as THREE.Mesh).isMesh) objects.push(c); });
        const hits = this.raycaster.intersectObjects(objects);
        if (hits.length > 0) {
            let obj = hits[0].object;
            while (obj && obj.userData.bodyID === undefined && obj.parent) {
                obj = obj.parent;
            }
            const bodyId = obj && obj.userData.bodyID !== undefined ? obj.userData.bodyID : -1;
            return { point: hits[0].point, bodyId };
        }
        return null;
    }

    clearErMarkers() { this.erGroup.clear(); }

    addErMarker(position: THREE.Vector3, label: string, id: number) {
        const cone = new THREE.Mesh(
            new THREE.ConeGeometry(0.015, 0.05, 16),
            new THREE.MeshStandardMaterial({ color: 0x4f46e5, emissive: 0x312e81 })
        );
        cone.geometry.rotateX(-Math.PI / 2);
        const group = new THREE.Group();
        group.position.set(position.x, position.y, 0.01);
        group.position.z += 0.1; 
        group.userData.baseZ = group.position.z;
        group.userData.erId = id;
        group.add(cone);
        this.erGroup.add(group);
    }
    
    removeMarkerById(id: number) {
        for (let i = this.erGroup.children.length - 1; i >= 0; i--) {
            const child = this.erGroup.children[i];
            if (child.userData.erId === id) this.erGroup.remove(child);
        }
    }

    checkMarkerClick(x: number, y: number): THREE.Vector3 | null {
        const rect = this.renderer.domElement.getBoundingClientRect();
        const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
        this.raycaster.setFromCamera(ndc, this.camera);
        const hits = this.raycaster.intersectObjects(this.erGroup.children, true);
        if (hits.length > 0) {
            let obj = hits[0].object;
            while(obj.parent && obj.parent !== this.erGroup) obj = obj.parent;
            return new THREE.Vector3(obj.position.x, obj.position.y, obj.userData.baseZ - 0.1);
        }
        return null;
    }

    onResize = () => {
        if (!this.container) return;
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
        this.cssRenderer.setSize(this.container.clientWidth, this.container.clientHeight);
    };

    /** Get-or-create the wrist feed for an arm, applying the current shared mount/intrinsics. */
    ensureWristCamera(armId: string): WristCamera {
        let cam = this.wristCameras.get(armId);
        if (!cam) {
            cam = new WristCamera(this.scene);
            cam.armId = armId;
            cam.enabled = true;
            this.applyWristMount(cam);
            this.wristCameras.set(armId, cam);
        }
        return cam;
    }

    getWristCamera(armId: string): WristCamera | undefined {
        return this.wristCameras.get(armId);
    }

    /** Dispose wrist feeds whose arm no longer exists (called when arms are added/removed). */
    syncWristArms(armIds: string[]) {
        const keep = new Set(armIds);
        for (const [id, cam] of this.wristCameras) {
            if (!keep.has(id)) { cam.dispose(); this.wristCameras.delete(id); }
        }
    }

    /** Update the shared wrist mount offsets + FOV; re-applies to every live feed. */
    setWristMount(m: { back: number; up: number; reach: number; fov: number }) {
        this.wristMount.back = m.back; this.wristMount.up = m.up;
        this.wristMount.reach = m.reach; this.wristMount.fov = m.fov;
        this.wristCameras.forEach((c) => this.applyWristMount(c));
    }

    private applyWristMount(c: WristCamera) {
        c.back = this.wristMount.back; c.up = this.wristMount.up; c.reach = this.wristMount.reach;
        c.setIntrinsics(this.wristMount.fov, this.wristMount.aspect);
    }

    dispose() {
        window.removeEventListener('resize', this.onResize);
        this.cameraRig.dispose();
        this.wristCameras.forEach((c) => c.dispose());
        this.wristCameras.clear();
        this.baseBuilder.dispose();
        this.measureTool.dispose();
        this.selection.dispose();
        this.cssRenderer.domElement.remove();
        this.planningArmsGroup.clear();
        this.scene.remove(this.planningArmsGroup);
        this.renderer.dispose();
        this.controls.dispose();
    }
}
