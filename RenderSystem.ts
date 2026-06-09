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
import { StationCamera } from './StationCamera';
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
    /** One overhead feed per satellite workstation (#6), keyed by station id. */
    stationCameras = new Map<string, StationCamera>();
    stationEnabled = false; // master toggle for all station feeds
    /** Extra placeable overhead D435i cameras (reuse the StationCamera overhead-PIP machinery). */
    extraCameras = new Map<string, StationCamera>();
    extraCamerasEnabled = false;
    gripperSiteId = -1; // set by MujocoSim so the wrist cam can track the end-effector
    private wristMount = { posX: 0, posY: 0.14, posZ: 0.02, fov: 58, tilt: 25, aspect: 16 / 9 };
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
    /** When set, the main view is rendered as two scissor halves (A | B) with one renderer — the
     *  Compare v2 split. Both cams share the live orbit (az/el/radius) but look at their own cell
     *  centroid, so dragging the NavCube turns both setups together with zero extra GL contexts. */
    compareSplit: { camA: THREE.PerspectiveCamera; camB: THREE.PerspectiveCamera; targetA: THREE.Vector3; targetB: THREE.Vector3 } | null = null;
    private tmpSize = new THREE.Vector2();
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

        // Safety net: if the main GL context is ever lost (e.g. too many live contexts), preventDefault
        // so the browser can RESTORE it instead of leaving the sim permanently blank. three.js re-uploads
        // its GPU resources on 'webglcontextrestored', so the scene comes back on the next frame.
        this.renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); console.warn('[RenderSystem] WebGL context lost — awaiting restore'); }, false);
        this.renderer.domElement.addEventListener('webglcontextrestored', () => console.warn('[RenderSystem] WebGL context restored'), false);

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
            () => [this.simGroup, this.baseBuilder.group, this.cameraRig.gizmo, this.planningArmsGroup,
                   ...Array.from(this.extraCameras.values()).map((c) => c.glyph),
                   ...Array.from(this.stationCameras.values()).map((c) => c.glyph),
                   ...Array.from(this.wristCameras.values()).map((c) => c.glyph)],
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
        // The primary D435i's drag gizmo (axis) shows only while it's selected — "click first", like
        // every other object (setSelected no-ops when unchanged, so this is cheap per frame).
        this.cameraRig.setSelected(this.selection.current?.kind === 'camera' && !this.selection.current.cameraId);

        // FOV frustum + ground footprint for the station/extra overheads — mirror the primary D435i's
        // toggles (DRY), so every overhead camera shows the same overlays. Updated before the render;
        // collected so the PIP feeds can hide them (a camera shouldn't see FOV lines).
        const sf = this.cameraRig.showFrustum, sfp = this.cameraRig.showFootprint;
        this.stationCameras.forEach((c) => c.updateOverlay(this.stationEnabled && sf, this.stationEnabled && sfp));
        this.extraCameras.forEach((c) => c.updateOverlay(this.extraCamerasEnabled && sf, this.extraCamerasEnabled && sfp));
        const camOverlays: THREE.Object3D[] = [
            ...Array.from(this.stationCameras.values()).flatMap((c) => c.overlays),
            ...Array.from(this.extraCameras.values()).flatMap((c) => c.overlays),
        ];

        if (this.compareSplit) this.renderCompareSplit();
        else this.renderer.render(this.scene, this.camera);

        // Sensor-camera overlays + PIP. Runs after the main view so its helper-hiding
        // (for clean PIP "footage") never affects what the user sees in the main viewport.
        // Hide the camera post in every PIP: the real D435i is mounted ON the post, so its footage
        // never contains the post — the sim PIP should match that to represent reality faithfully.
        // NOTE: planningArmsGroup (the FK-posed ghost clones = every NON-primary arm) is intentionally
        // NOT hidden here, so additional arms appear in the overhead D435i footage too — only the
        // primary is a real physics body, the rest are ghosts. (Other overlays/grid still hidden.)
        const pipHide = [this.grid, this.erGroup, this.originAxes, this.measureTool.group, this.selection.group, ...this.baseBuilder.postMeshes, ...this.extraPipHelpers, ...camOverlays];
        this.cameraRig.update(this.simGroup, pipHide);

        // Visible camera-body glyphs follow each feed's enable toggle.
        this.wristCameras.forEach((c) => c.setGlyphVisible(this.wristEnabled));
        this.stationCameras.forEach((c) => c.setGlyphVisible(this.stationEnabled));
        this.extraCameras.forEach((c) => c.setGlyphVisible(this.extraCamerasEnabled));

        // Wrist-cam footage: one feed per arm. Each tracks its own end-effector + renders its PIP.
        if (this.wristEnabled && this.gripperSiteId >= 0 && this.wristCameras.size > 0) {
            // Base wrist hide = overlays + the floating D435i rig + grid/axes/etc — but NOT the whole
            // planningArmsGroup (the overhead D435i hides it; the wrist cams must NOT, or a ghost arm's
            // own wrist cam can't see its own gripper). We hide the OTHER ghosts per-camera below.
            const wristBase = [this.grid, this.erGroup, this.originAxes, this.measureTool.group,
                this.selection.group, ...this.baseBuilder.postMeshes, ...this.extraPipHelpers, ...this.cameraRig.overlays, ...camOverlays];
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

        // Per-station overhead feeds (#6): a fixed downward camera on each station's post. Hide the
        // same decorations the overhead D435i hides — but keep the arms (incl. ghosts) visible.
        if (this.stationEnabled && this.stationCameras.size > 0) {
            const sHide = [this.grid, this.erGroup, this.originAxes, this.measureTool.group,
                this.selection.group, ...this.baseBuilder.postMeshes, ...this.extraPipHelpers, ...this.cameraRig.overlays, ...camOverlays];
            this.stationCameras.forEach((cam) => cam.renderPip(sHide));
        }
        // Extra placeable overhead D435i cameras — same clean hide-list.
        if (this.extraCamerasEnabled && this.extraCameras.size > 0) {
            const eHide = [this.grid, this.erGroup, this.originAxes, this.measureTool.group,
                this.selection.group, ...this.baseBuilder.postMeshes, ...this.extraPipHelpers, ...this.cameraRig.overlays, ...camOverlays];
            this.extraCameras.forEach((cam) => cam.renderPip(eHide));
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
            bodyClone.userData.__bodyId = bodyId; // so a ghost can be re-posed per-body via the FK oracle
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

    setPlanningArmInstances(
        instances: ArmInstance[],
        poseFor?: (joints: number[]) => { bodies: Map<number, THREE.Matrix4>; tcp: THREE.Matrix4 | null } | null,
    ) {
        this.planningArmsGroup.clear();
        if (!this.planningArmTemplate) return;
        for (const instance of instances) {
            if (instance.primary) continue;
            const clone = this.planningArmTemplate.clone(true);
            clone.position.set(instance.x, instance.y, 0);
            clone.rotation.z = instance.yaw;
            clone.userData.armId = instance.id;
            clone.userData.selectable = 'arm'; // pickable + carries its armId for per-arm outline
            // Pose this ghost at its OWN joint angles via the FK oracle (else it shows the home pose).
            const t = instance.joints && poseFor ? poseFor(instance.joints) : null;
            if (t) {
                clone.children.forEach((c) => {
                    const bid = c.userData.__bodyId as number | undefined;
                    if (typeof bid === 'number' && t.bodies.has(bid)) t.bodies.get(bid)!.decompose(c.position, c.quaternion, c.scale);
                    else if (c.userData.isTcp && t.tcp) t.tcp.decompose(c.position, c.quaternion, c.scale);
                });
            }
            this.planningArmsGroup.add(clone);
        }
    }

    /** A standalone, posed clone of the real arm geometry — for the WebGL compare scenes (so they
     *  show the actual SO-101 meshes, matching the workcell page). Geometry is shared with the
     *  template (do NOT dispose it). */
    makePosedArmClone(x: number, y: number, yaw: number, t: { bodies: Map<number, THREE.Matrix4>; tcp: THREE.Matrix4 | null } | null): THREE.Group | null {
        if (!this.planningArmTemplate) return null;
        const clone = this.planningArmTemplate.clone(true);
        clone.position.set(x, y, 0); clone.rotation.z = yaw;
        clone.userData.armId = undefined; clone.userData.selectable = undefined;
        if (t) clone.children.forEach((c) => {
            const bid = c.userData.__bodyId as number | undefined;
            if (typeof bid === 'number' && t.bodies.has(bid)) t.bodies.get(bid)!.decompose(c.position, c.quaternion, c.scale);
        });
        return clone;
    }

    /** Re-pose one existing ghost clone in place (no re-clone) from FK-oracle transforms — used by
     *  the live drag-jog so the held joint node isn't replaced mid-drag. */
    poseGhost(armId: string, t: { bodies: Map<number, THREE.Matrix4>; tcp: THREE.Matrix4 | null } | null) {
        if (!t) return;
        const clone = this.planningArmsGroup.children.find((c) => c.userData.armId === armId);
        if (!clone) return;
        clone.children.forEach((c) => {
            const bid = c.userData.__bodyId as number | undefined;
            if (typeof bid === 'number' && t.bodies.has(bid)) t.bodies.get(bid)!.decompose(c.position, c.quaternion, c.scale);
            else if (c.userData.isTcp && t.tcp) t.tcp.decompose(c.position, c.quaternion, c.scale);
        });
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

    private depthRT: THREE.WebGLRenderTarget | null = null;
    // Linear-depth override: writes normalized view-space depth straight to the colour channel, so a
    // byte readback IS the depth (no RGBA depth-packing → no precision loss, no colour-space/tone-map
    // corruption). uNear/uFar bracket the scene; r=1 (white clear) = background/far.
    private readonly depthMat = new THREE.ShaderMaterial({
        uniforms: { uNear: { value: 0.3 }, uFar: { value: 1.8 } },
        vertexShader: 'varying float vZ; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vZ = -mv.z; gl_Position = projectionMatrix * mv; }',
        fragmentShader: 'varying float vZ; uniform float uNear; uniform float uFar; void main(){ float d = clamp((vZ - uNear)/(uFar - uNear), 0.0, 1.0); gl_FragColor = vec4(d, d, d, 1.0); }',
    });

    /** Render a linearized, min-max-normalized depth image (w×h, row-major, y-down) of the scene from
     *  `camera`. Used by the analysis "depth map" figure. `hide` lets the caller drop overlay groups
     *  (planner tiles, ghosts) so only real geometry shows. Values: 0 = nearest geom, 1 = farthest
     *  geom; background (no geometry) is returned as NaN so the figure can skip it. */
    renderDepth(camera: THREE.PerspectiveCamera, w: number, h: number, hide: THREE.Object3D[] = [], near = 0.3, far = 1.8): { depth: Float32Array; w: number; h: number } {
        if (!this.depthRT || this.depthRT.width !== w || this.depthRT.height !== h) {
            this.depthRT?.dispose();
            this.depthRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
        }
        // Tighten the frustum to the scene's depth band — the camera's own far (≈100 m) would crush all
        // table depth into the float LSBs and the packed-depth decode would be pure quantization noise.
        const savedNear = camera.near, savedFar = camera.far;
        camera.near = near; camera.far = far; camera.updateProjectionMatrix();
        this.depthMat.uniforms.uNear.value = near; this.depthMat.uniforms.uFar.value = far;
        const wasHidden = hide.map((o) => o.visible); hide.forEach((o) => (o.visible = false));
        const prevTarget = this.renderer.getRenderTarget(), prevOverride = this.scene.overrideMaterial, prevBg = this.scene.background;
        this.scene.overrideMaterial = this.depthMat;
        this.scene.background = null;
        this.renderer.setRenderTarget(this.depthRT);
        this.renderer.setClearColor(0xffffff, 1); this.renderer.clear(); // white (r=1) = far / background
        this.renderer.render(this.scene, camera);
        this.renderer.setRenderTarget(prevTarget);
        this.scene.overrideMaterial = prevOverride; this.scene.background = prevBg;
        hide.forEach((o, i) => (o.visible = wasHidden[i]));
        camera.near = savedNear; camera.far = savedFar; camera.updateProjectionMatrix(); // restore

        const buf = new Uint8Array(w * h * 4);
        this.renderer.readRenderTargetPixels(this.depthRT, 0, 0, w, h, buf);
        const depth = new Float32Array(w * h);
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const d = buf[((h - 1 - y) * w + x) * 4] / 255; // R channel = normalized linear depth (readPixels is bottom-up)
            depth[y * w + x] = d >= 0.999 ? NaN : d;        // background / far → skip
        }
        // HEIGHT-ABOVE-TABLE instead of raw depth: a global stretch/curve can't fix a TILTED camera —
        // the near→far planar ramp owns the whole range, so objects on the table blend in. The table
        // is z=0 in world and we know the camera pose+intrinsics, so we can compute the EXPECTED table
        // depth per pixel analytically (ray → z=0 plane) and show the residual (metres above the table).
        // That residual is ~0 everywhere on the table regardless of tilt, so objects pop out. (B4)
        const viewMat = camera.matrixWorldInverse;
        const pN = new THREE.Vector3(), pF = new THREE.Vector3(), dir = new THREE.Vector3(), hit = new THREE.Vector3();
        const BAND = 0.12;   // metres above the table mapped to full colour (a ~5 cm cube lands mid-scale)
        const DEAD = 0.004;  // ignore < 4 mm so depth noise/quantization keeps the table a flat colour
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const i = y * w + x; const dn = depth[i];
            if (Number.isNaN(dn)) continue;
            const measured = near + dn * (far - near);              // metres: actual depth at this pixel
            const ndcX = (x + 0.5) / w * 2 - 1, ndcY = 1 - (y + 0.5) / h * 2;
            pN.set(ndcX, ndcY, -1).unproject(camera);               // near-plane point on this pixel's ray
            pF.set(ndcX, ndcY, 1).unproject(camera);                // far-plane point on the same ray
            dir.copy(pF).sub(pN);
            const t = dir.z !== 0 ? -pN.z / dir.z : -1;             // intersect the table plane z=0
            if (t <= 0) { depth[i] = 0; continue; }
            hit.copy(pN).addScaledVector(dir, t).applyMatrix4(viewMat); // world hit → view space
            const height = -hit.z - measured;                       // expected table depth − measured (objects > 0)
            depth[i] = height < DEAD ? 0 : Math.min(1, height / BAND);
        }
        return { depth, w, h };
    }

    private readonly covRay = new THREE.Raycaster();
    /** For each world point (a table cell centre), is it VISIBLE to `camera` — inside the FOV frustum
     *  AND not occluded by geometry (arm / posts / cubes) before reaching the table? Used by the
     *  camera-coverage figure. Occluders = real scene geometry (simGroup + worktop/posts). */
    computeCoverage(camera: THREE.PerspectiveCamera, points: THREE.Vector3[]): boolean[] {
        camera.updateMatrixWorld();
        const camPos = camera.getWorldPosition(new THREE.Vector3());
        const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
        const occluders: THREE.Object3D[] = [this.simGroup, this.baseBuilder.group];
        const dir = new THREE.Vector3();
        return points.map((P) => {
            if (!frustum.containsPoint(P)) return false;             // outside the camera FOV
            dir.copy(P).sub(camPos); const dist = dir.length(); dir.normalize();
            this.covRay.set(camPos, dir); this.covRay.far = dist + 0.05;
            const hit = this.covRay.intersectObjects(occluders, true).find((h) => (h.object as THREE.Mesh).isMesh && h.object.visible);
            return !hit || hit.distance >= dist - 0.04;              // first hit is the table itself (not an occluder in front)
        });
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

    /** Enter Compare v2 split: render the live scene as two scissor halves framing targetA | targetB,
     *  both sharing the live orbit. Disables OrbitControls (the CompareView overlay drives orbit). */
    setCompareSplit(targetA: THREE.Vector3, targetB: THREE.Vector3) {
        const mk = () => {
            const c = new THREE.PerspectiveCamera(this.camera.fov, 1, this.camera.near, this.camera.far);
            c.up.set(0, 0, 1);
            return c;
        };
        this.compareSplit = {
            camA: this.compareSplit?.camA ?? mk(),
            camB: this.compareSplit?.camB ?? mk(),
            targetA: targetA.clone(),
            targetB: targetB.clone(),
        };
        // Keep OrbitControls live so dragging anywhere rotates/zooms BOTH cells together (each cell
        // cam shares the orbit az/el+radius). Disable panning so the target stays put and the shared
        // az/el derivation stays stable.
        this.controls.enablePan = false;
    }

    /** Update just the cell centroids without rebuilding the cameras (cheap, called as cells move). */
    setCompareTargets(targetA: THREE.Vector3, targetB: THREE.Vector3) {
        if (!this.compareSplit) return;
        this.compareSplit.targetA.copy(targetA);
        this.compareSplit.targetB.copy(targetB);
    }

    clearCompareSplit() {
        this.compareSplit = null;
        this.controls.enablePan = true;
        const w = this.tmpSize; this.renderer.getSize(w);
        this.renderer.setViewport(0, 0, w.x, w.y);
        this.renderer.setScissor(0, 0, w.x, w.y);
        this.renderer.setScissorTest(false);
    }

    /** Position one cell camera from a shared (az,el,radius) orbit, looking at its own centroid. */
    private placeCellCam(cam: THREE.PerspectiveCamera, target: THREE.Vector3, az: number, el: number, r: number, aspect: number) {
        const ce = Math.cos(el);
        cam.position.set(target.x + Math.sin(az) * ce * r, target.y + Math.cos(az) * ce * r, target.z + Math.sin(el) * r);
        cam.aspect = aspect;
        cam.updateProjectionMatrix();
        cam.lookAt(target);
    }

    /** Draw the scene twice (A | B) into left/right scissor halves of the single canvas. */
    private renderCompareSplit() {
        const s = this.compareSplit!;
        // Derive the shared orbit from the main camera (NavCube / pane-drag move it via orbit()).
        const off = this.camera.position.clone().sub(this.controls.target);
        const r = Math.max(off.length(), 1e-3);
        const az = Math.atan2(off.x, off.y);
        const el = Math.atan2(off.z, Math.hypot(off.x, off.y));

        this.renderer.getSize(this.tmpSize);
        const w = this.tmpSize.x, h = this.tmpSize.y;
        const halfW = Math.floor(w / 2);
        const gap = 1; // 1px seam so the two views read as separate panes

        this.renderer.setScissorTest(true);
        // Left = cell A
        this.placeCellCam(s.camA, s.targetA, az, el, r, halfW / h);
        this.renderer.setViewport(0, 0, halfW - gap, h);
        this.renderer.setScissor(0, 0, halfW - gap, h);
        this.renderer.render(this.scene, s.camA);
        // Right = cell B
        const rw = w - halfW - gap;
        this.placeCellCam(s.camB, s.targetB, az, el, r, rw / h);
        this.renderer.setViewport(halfW + gap, 0, rw, h);
        this.renderer.setScissor(halfW + gap, 0, rw, h);
        this.renderer.render(this.scene, s.camB);

        this.renderer.setScissorTest(false);
        this.renderer.setViewport(0, 0, w, h);
        this.renderer.setScissor(0, 0, w, h);
    }

    /** Pan tool (Fusion-style hand): when on, a LEFT-drag pans the camera instead of orbiting. */
    setPanMode(on: boolean) {
        this.controls.enablePan = true;
        this.controls.mouseButtons.LEFT = on ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    }

    /** Orbit the camera by (dAz, dEl) radians around the target — for dragging the NavCube to rotate
     *  the view (Z-up spherical, matching the cube's az=atan2(x,y) / el=atan2(z,·) convention). */
    orbit(dAz: number, dEl: number) {
        const off = this.camera.position.clone().sub(this.controls.target);
        const r = off.length();
        if (r < 1e-6) return;
        let az = Math.atan2(off.x, off.y);
        let el = Math.atan2(off.z, Math.hypot(off.x, off.y));
        az += dAz;
        el = Math.max(-1.5533, Math.min(1.5533, el + dEl)); // clamp just shy of ±90° to avoid gimbal flip
        const ce = Math.cos(el);
        this.camera.position.set(
            this.controls.target.x + Math.sin(az) * ce * r,
            this.controls.target.y + Math.cos(az) * ce * r,
            this.controls.target.z + Math.sin(el) * r,
        );
        this.camera.lookAt(this.controls.target);
        this.controls.update();
    }

    /** Snap the orbit camera to a named view OR an arbitrary direction (NavCube faces/edges/corners).
     *  Reuses the moveCameraTo animation; the worktop is at the origin so every view looks at (0,0,0).
     *  A direction array [x,y,z] (Z-up world) places the camera along that ray — used for the cube's
     *  corner→iso and edge→45° two-face views. */
    snapToView(preset: 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right' | 'iso' | [number, number, number]) {
        const D = 2.4, Z = 0.4;
        let pos: THREE.Vector3;
        if (Array.isArray(preset)) {
            const dir = new THREE.Vector3(preset[0], preset[1], preset[2]);
            if (dir.lengthSq() < 1e-9) dir.set(1.8, -1.4, 2.0);
            pos = dir.normalize().multiplyScalar(2.95); // ~iso distance
        } else {
            const P: Record<string, THREE.Vector3> = {
                top: new THREE.Vector3(0, -0.001, D + 0.5),   // tiny -Y offset avoids Z-up gimbal + keeps the cube axis-aligned
                bottom: new THREE.Vector3(0, -0.001, -(D + 0.5)),
                front: new THREE.Vector3(0, -D, Z),
                back: new THREE.Vector3(0, D, Z),
                left: new THREE.Vector3(-D, 0, Z),
                right: new THREE.Vector3(D, 0, Z),
                iso: new THREE.Vector3(1.8, -1.4, 2.0),
            };
            pos = P[preset] ?? P.iso;
        }
        this.moveCameraTo(pos, new THREE.Vector3(0, 0, 0), 360);
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
            // tag the glyph so the SelectionController can pick this wrist cam (move/aim gizmo).
            cam.glyph.userData.selectable = 'wristcam'; cam.glyph.userData.armId = armId;
            cam.glyph.traverse((o) => { o.userData.selectable = 'wristcam'; o.userData.armId = armId; });
            this.applyWristMount(cam);
            this.wristCameras.set(armId, cam);
        }
        return cam;
    }

    getWristCamera(armId: string): WristCamera | undefined {
        return this.wristCameras.get(armId);
    }

    /** Get-or-create a station's overhead feed. Its glyph is selectable (move/aim) just like the
     *  placeable extra cameras — tagged with id `stationcam:<stationId>` so App routes its pose to
     *  the station's camPose override. */
    ensureStationCamera(id: string): StationCamera {
        let cam = this.stationCameras.get(id);
        if (!cam) {
            cam = new StationCamera(this.scene);
            const camId = `stationcam:${id}`;
            cam.glyph.userData.selectable = 'camera'; cam.glyph.userData.cameraId = camId;
            cam.glyph.traverse((o) => { o.userData.selectable = 'camera'; o.userData.cameraId = camId; });
            this.stationCameras.set(id, cam);
        }
        return cam;
    }
    getStationCamera(id: string): StationCamera | undefined {
        return this.stationCameras.get(id);
    }

    /** Reconcile station feeds with the current stations: set each camera's overhead pose (post →
     *  worktop centre) and dispose feeds whose station is gone. */
    syncStationCameras(stations: Array<{ id: string; x: number; y: number; yaw?: number; postX: number; postY: number; postHeight: number; camPose?: { x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number }; camFovDeg?: number }>) {
        const keep = new Set(stations.map((s) => s.id));
        for (const [id, cam] of this.stationCameras) {
            if (!keep.has(id)) { cam.dispose(); this.stationCameras.delete(id); }
        }
        for (const s of stations) {
            const cam = this.ensureStationCamera(s.id);
            if (s.camFovDeg) cam.setFovHoriz(s.camFovDeg);
            if (s.camPose) { cam.setPoseEuler(s.camPose.x, s.camPose.y, s.camPose.z, s.camPose.rotX, s.camPose.rotY, s.camPose.rotZ); continue; }
            // Default: overhead, post → worktop centre (rotate the post offset by the station yaw).
            const c = Math.cos(s.yaw ?? 0), sn = Math.sin(s.yaw ?? 0);
            const px = s.x + s.postX * c - s.postY * sn;
            const py = s.y + s.postX * sn + s.postY * c;
            cam.setPose(px, py, s.postHeight, s.x, s.y);
        }
    }

    ensureExtraCamera(id: string): StationCamera {
        let cam = this.extraCameras.get(id);
        if (!cam) {
            cam = new StationCamera(this.scene);
            // tag the glyph (group + children) so the SelectionController can pick THIS camera.
            cam.glyph.userData.selectable = 'camera'; cam.glyph.userData.cameraId = id;
            cam.glyph.traverse((o) => { o.userData.selectable = 'camera'; o.userData.cameraId = id; });
            this.extraCameras.set(id, cam);
        }
        return cam;
    }
    getExtraCamera(id: string): StationCamera | undefined { return this.extraCameras.get(id); }

    /** Reconcile the extra overhead cameras with config: position (x,y,z) + euler aim (rotX/Y/Z) + FOV. */
    syncExtraCameras(cams: Array<{ id: string; x: number; y: number; z: number; rotX: number; rotY: number; rotZ: number; fovDeg?: number }>) {
        const keep = new Set(cams.map((c) => c.id));
        for (const [id, cam] of this.extraCameras) {
            if (!keep.has(id)) { cam.dispose(); this.extraCameras.delete(id); }
        }
        for (const c of cams) {
            const cam = this.ensureExtraCamera(c.id);
            if (c.fovDeg) cam.setFovHoriz(c.fovDeg);
            cam.setPoseEuler(c.x, c.y, c.z, c.rotX, c.rotY, c.rotZ);
        }
    }

    /** Dispose wrist feeds whose arm no longer exists (called when arms are added/removed). */
    syncWristArms(armIds: string[]) {
        const keep = new Set(armIds);
        for (const [id, cam] of this.wristCameras) {
            if (!keep.has(id)) { cam.dispose(); this.wristCameras.delete(id); }
        }
    }

    /** Update the shared wrist mount offsets + FOV; re-applies to every live feed. */
    setWristMount(m: { posX: number; posY: number; posZ: number; fov: number; tilt: number }) {
        this.wristMount.posX = m.posX; this.wristMount.posY = m.posY; this.wristMount.posZ = m.posZ;
        this.wristMount.fov = m.fov; this.wristMount.tilt = m.tilt;
        this.wristCameras.forEach((c) => this.applyWristMount(c));
    }

    private applyWristMount(c: WristCamera) {
        c.posX = this.wristMount.posX; c.posY = this.wristMount.posY; c.posZ = this.wristMount.posZ;
        c.tiltDeg = this.wristMount.tilt;
        c.setIntrinsics(this.wristMount.fov, this.wristMount.aspect);
    }

    dispose() {
        window.removeEventListener('resize', this.onResize);
        this.cameraRig.dispose();
        this.wristCameras.forEach((c) => c.dispose());
        this.wristCameras.clear();
        this.stationCameras.forEach((c) => c.dispose());
        this.stationCameras.clear();
        this.extraCameras.forEach((c) => c.dispose());
        this.extraCameras.clear();
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
