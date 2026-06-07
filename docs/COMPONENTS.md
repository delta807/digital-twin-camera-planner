# Reusable Components & Modules

> **Purpose: don't recreate what already exists.** This is the catalogue of every reusable
> component, engine class, type, and helper, with its public API and a "reuse when" note. Skim
> §5 ("Before you write new code") first. All paths are repo-root-relative (flat layout; React
> components live in `components/`).

---

## 1. React components

All components take `isDarkMode: boolean` for theming (omitted below unless load-bearing). Many also
accept `inline?: boolean` to render as a flow card inside the sidebar dashboard instead of a
free-floating panel.

| Component | File | Key props | Purpose | Reuse when |
|---|---|---|---|---|
| `SelectionInspector` | `components/SelectionInspector.tsx` | `selection: SelectionInfo \| null`, `unit: LengthUnit`, per-kind transforms + write-back callbacks (`onArm`, `onStation`, `onExtraCamera`, `onProp`, `onCamera`, `onPost`, `onObject`, `onWristMount`…), `onAimDown`, `onSnapToPost/Rod/Edge`, `onSlideAlongRod(t)`, migrated dock controls (`camera: CameraCardControls`, `armReach`, `armJoints`, `workcell`), `inline?` | OrcaSlicer-style card that edits the **selected entity's** control point (X/Y/Z/yaw, sliders, joint jog, camera optics, wrist mount, rod-snap). Unit-aware (m/mm), origin = table centre. | You need a transform/edit panel for a selected scene entity. Exports `CameraCardControls`, `InspectorProps`. |
| `UnifiedSidebar` | `components/UnifiedSidebar.tsx` | `isOpen`, `onClose`, `onSend(prompt,type,temperature,enableThinking,modelId)`, `onPickup`, `isLoading`, `hasDetectedItems`, `logs: LogEntry[]`, `onOpenLog`, slot props `inspector`/`headerContent`/`feeds`/`toolbar`/`overlays: ReactNode` | The main right-hand dashboard (Camera Feeds → Selection → Controls → Embodied Reasoning → Overlays). | You need the primary app dashboard / Gemini reasoning UI. |
| `WorkspaceDock` | `components/WorkspaceDock.tsx` | `objects?: DockObjectsProps`, `scene: DockSceneProps`, `workcell: DockWorkcellProps`, `arms: DockArmsProps`, `templates?: DockTemplatesProps`, `onSaveWorkspace?`, `onClose?` | Left "build" panel: Layouts, Insert palette (arm/camera/station/post/object), Bodies outliner, Scene toggles + coord readout + reachability compute. | You need the scene outliner / insert palette / global build controls. Exports `DockSceneProps`, `DockWorkcellProps`, `DockArmsProps`, `DockObjectEntity`, `DockObjectsProps`, `DockTemplatesProps`. |
| `SensorView` | `components/SensorView.tsx` | `canvasHostRef: Ref<HTMLDivElement>`, `aspect`, `onClose`, `title?`, `secondary?`, `topRem?`, `compare?: CompareOverlay`, `depth?: {on,onToggle}`, `inline?` | PIP panel hosting a camera's live render; optional RGB/Depth toggle and real-vs-sim superimpose (opacity + difference blend, fallback still on stream error). | You need a camera-feed PIP or a real/sim overlay control. Exports `CompareOverlay`. |
| `LayoutProfiles` | `components/LayoutProfiles.tsx` | `profiles: LayoutProfile[]`, `onSave(name)`, `onLoad(p)`, `onDelete(name)`, `onPublish?(): Promise<boolean>`, `onClose?` | Save/load/delete named layout profiles, publish to team (Netlify Blobs), Export-JSON for committing into `presets.ts`. | You need the profile-management UI (built-in/team/local badges handled). |
| `CompareView` | `components/CompareView.tsx` | `onExit`, `labelA?`, `labelB?`, `feedsA?: ReactNode`, `feedsB?: ReactNode` | **v2 (current):** a `pointer-events-none` transparent HUD over the LIVE split canvas — the two setups are rendered by the single MuJoCo renderer into left/right scissor halves (`RenderSystem.renderCompareSplit`). Draws only chrome: A/B badges, centre seam, per-pane feeds, exit. Dragging orbits both cells; scene stays live/editable underneath. | You need the A/B compare chrome overlay. *(Older SVG/WebGL-pane compare via `SceneMap`/`CompareScene3D` is being retired — see ARCHITECTURE §3 note.)* |
| `SceneMap` *(legacy/compare-rework)* | `components/SceneMap.tsx` | `setup: CompareSetup`, `az?`, `el?` | Pure-SVG rotatable isometric schematic of one setup (table, arm glyph, post, camera + footprint, reach envelope, blocks). No WebGL. | Lightweight 2D schematic/thumbnail of a setup. Exports `CompareSetup`, `Proj`. May be removed by the compare rework — check it's still imported before relying on it. |
| `CompareScene3D` *(legacy/compare-rework)* | `components/CompareScene3D.tsx` | `setup: CompareSetup`, `az`, `el`, `makeArmClone(a) => THREE.Group \| null` | On-demand static WebGL render of one captured setup using the real worktop + SO-101 meshes. | Small static real-mesh preview. Same caveat as `SceneMap`. |
| `Toolbar` | `components/Toolbar.tsx` | `isPaused`, `togglePause`, `onReset`, `showSidebar`, `toggleSidebar`, `toggleDarkMode`, `onResetView`, `onFrameSelection`, `tweaksOpen`, `onToggleTweaks`, `jogActive?`, `measureActive?`, `inline?` | Floating sim action bar: play/pause, reset, reset-view, frame selection, jog, measure, dark-mode, tweaks. | You need sim playback/view action buttons. |
| `NavCube` | `components/NavCube.tsx` | `onView(p: ViewPreset)`, `getOrbit()`, `onDragRotate?(dAz,dEl)`, `dockOpen`, `sidebarOpen` | CAD orientation cube: mirrors live camera orientation, 6 faces snap to views, drag to orbit. | You need a view-cube / orientation widget. Exports `ViewPreset`. |
| `FeedsDock` | `components/FeedsDock.tsx` | `open`, `onToggle`, `reasoningOpen`, `onReasoning`, `sidebarOpen`, `toggles:{overhead,wrist,station?,extraCam?}`, `feedCount`, `children` | Collapses all camera PIPs into one bounded, scrollable right-edge panel + a toggle rail + feed-count badge. | You need to host many camera feeds without overflowing the viewport. |
| `TweaksPanel` | `components/TweaksPanel.tsx` | `onToggleTheme`, `open`, `onClose`, `sidebarOpen` | Appearance controls: theme + accent hue (writes `--accent-h`, persisted). | You need theme/accent customization. |
| `OverlayLegend` | `components/OverlayLegend.tsx` | `camera: CameraViewToggles`, `planner: PlannerToggles`, `dockOpen`, `inline?` | Legend keyed to active overlays (camera=amber, reach=violet, precision=cyan, object=terracotta). Self-hides when nothing's active. | You need a legend that auto-syncs to active overlays. |
| `RadialMenu` | `components/RadialMenu.tsx` | `x`, `y`, `items: RadialItem[]`, `onSelect(id)`, `onClose` | Right-click radial menu, items in a ring around the cursor. | You need a context/radial menu at a point. Exports `RadialItem`. |
| `MetricBar` | `components/MetricBar.tsx` | `armCount`, `baseResult: {covered,total}\|null`, `isPaused`, `inline?` | Status readout: arm count, reach %, MuJoCo state. | You need a compact status readout. |
| `ModeRail` | `components/ModeRail.tsx` | `mode: WorkMode`, `onMode`, `dockOpen`, `onToggleDock`, `perceiveOpen`, `onTogglePerceive`, `layoutsOpen`, `onToggleLayouts` | Far-left icon rail: brand, Edit/Compare modes, layout toggle. | You need a left-edge mode/nav rail. Exports `WorkMode`. |
| `RobotSelector` | `components/RobotSelector.tsx` | `gizmoStats: {pos,rot}\|null`, `robotName?` | Top-center overlay: robot name + live gizmo position/rotation. | You need a robot-name/gizmo-stats banner. |

---

## 2. Engine classes (extend, don't rewrite)

These own the heavy 3D/sim logic. Extend or call them — don't reimplement.

### `MujocoSim` — `MujocoSim.ts`
`constructor(container: HTMLElement, mujocoInstance: MujocoModule)`. Owns the MuJoCo model/data, the
render loop, arms, IK, task bodies.
- `relocateBase(x, y, yaw?): Promise<void>` — live move/rebuild the primary arm at a new mount.
- `setWorkcell(config: WorkcellConfig)` / `setArmInstances(instances: ArmInstance[])` — declarative sync.
- `getTaskBodies()` / `setTaskBodyPosition(bodyId,x,y,z)` / `setTaskBodyYaw(bodyId,yaw)`.
- `suggestArmLayout(n)` — auto-place n arms for max coverage.
- `posedArmClone(x,y,yaw,joints?): THREE.Group | null`.
- `getArmJointInfo()` / `setPrimaryJoint(index,angle)` / `armPoseTransforms(joints?)`.
- `moveArmTo(target, downWeight?): boolean` — numeric-IK reach.
- `moveIkTargetTo(pos, duration?)` / `setIkEnabled(enabled)`.
- `refreshGhostArms()`, `setEntityVisible(kind,id,visible)`, `reset()`, `setSpeedMultiplier(speed)`, `dispose()`.

### `RenderSystem` — `RenderSystem.ts`
`constructor(container, mujoco)`. Three.js renderer, scene, main camera/orbit, ER markers, aux cameras.
- `setDarkMode`, `setAxesVisible`, `initScene(mjModel)`, `update(mjData, showContacts)`, `syncBodiesFromData(mjData)`.
- Ghost arms: `buildPlanningArmTemplate(...)`, `setPlanningArmInstances(...)`, `makePosedArmClone(...)`, `poseGhost(armId,t)`.
- Camera: `moveCameraTo(...)`, `getCameraState()`, `orbit(dAz,dEl)`, `snapToView(preset)`, `frameView(...)`, `getCanvasSnapshot(...)`, `project2DTo3D(...)`.
- ER markers: `clearErMarkers()`, `addErMarker(pos,label,id)`, `removeMarkerById(id)`, `checkMarkerClick(x,y)`.
- Aux cameras: `ensureWristCamera(armId)`, `ensureStationCamera(id)`, `ensureExtraCamera(id)`, `syncStationCameras(...)`, `syncExtraCameras(...)`, `syncWristArms(armIds)`, `setWristMount(m)`.

### `WorkspaceCameraRig` — `WorkspaceCameraRig.ts`
Placeable primary D435i camera. Public `readonly gizmo`.
- `setEnabled`, `setToggles(t)`, `setIntrinsics(i)`, `getIntrinsics()`, `resetIntrinsics()`.
- `setDragMode('translate'|'rotate')`, `setPose(pos,target,roll?)`, `getPose()`, `applyPose(p)`, `aimDown()`.
- `attachPip(container)`, `detachPip()`, `setDepthMode(on)`, `update(occluderRoot, helpers)`, `computeCoverage(occluderRoot, opts?)`, `dispose()`.

### `WristCamera` — `WristCamera.ts`
Gripper-mounted camera glyph + PIP.
- `setGlyphVisible`, `setIntrinsics(fovV, aspect)`, `track(pos, xmat, base?)`, `trackFromMatrix(m)`.
- `worldToLocalOffset(world)`, `worldDirToTilt(dir)`, `attachPip`, `detachPip`, `renderPip(hideHelpers)`, `dispose()`.

### `StationCamera` — `StationCamera.ts`
Fixed/overhead camera glyph + PIP (also used for "extra" cameras).
- `setGlyphVisible`, `setPose(camX,camY,camZ,lookX,lookY)`, `setPoseEuler(...)`, `attachPip`, `detachPip`, `renderPip(hideHelpers)`, `dispose()`.

### `BaseBuilder` — `BaseBuilder.ts`
`constructor(scene: THREE.Scene)`. Worktop slab + rails + post(s) from a `WorkcellConfig`.
- `rebuild(config: WorkcellConfig)` — (re)create geometry (used by the live sim and any preview), `dispose()`.

### `MeasureTool` — `MeasureTool.ts`
`constructor(scene, camera, dom, getTargets)`. Two-point distance with snapping. Public `group`, `active`, `onChange`.
- `setActive(v)`, `setUnit(u)`, `clear()`, `remove(id)`, `dispose()`. Reports `Measurement[]` via `onChange`.

### `SelectionController` — `SelectionController.ts`
Click-to-select + outline + transform gizmo per kind.
- `selectByKind(kind,id?)`, `selectAt(clientX,clientY)`, `selectObjectByBodyId(id)`, `deselect()`.
- Aim toggles: `setArmAim`, `setStationAim`, `setObjectAim`, `setWristCamAim`, `setCameraAim`, `setPropAim` (each `(rotate: boolean)`).
- `setEnabled(on)`, `groundPointAt(clientX,clientY)`, `update()`, `dispose()`. Exports `SelectionKind`, `SelectionInfo`.

### `IkSystem` — `IkSystem.ts` (Franka analytical)
- `init(mjModel, isDouble)`, `syncToSite(mjData)`, `solve(pos,quat,currentQ): number[] | null`, `update(mjModel, mjData)`, `setMode(mode)`, `dispose()`.

### `NumericIk` — `NumericIk.ts` (any arm; DLS)
- `solve(target, seed, liveQpos?, downWeight?): {q: number[]; ok: boolean}`, `dispose()`.

### `SequenceAnimator` — `SequenceAnimator.ts` (Franka scripted pickup)
- `start(...)`, `update(dt, ...)`, `prepareStep(...)`, `stop()`, `reset()`.

### `WorkspacePlanner` — `WorkspacePlanner.ts`
`constructor(config: PlannerConfig)`. Reachability + base placement from one FK sweep.
- `setToggles(t)`, `setSearchBounds(halfX,halfY)`, `setArms(arms, primaryYaw)`, `computeReachability(res=9)`, `computeBasePlacement()`, `suggestArmLayout(n)`, `taskWorldPoints()`, `dispose()`. Exports `SweptJoint`, `PlannerToggles`, `PlannerConfig`.

---

## 3. Shared types & data

### `types.ts`
- **Types:** `DetectType`, `CameraIntrinsics` (`hFovDeg,aspect,near,far`), `CameraStreamProfile`, `CameraViewToggles`, `WorkcellConfig` (worktop `length/width`, `barHeight/barWidth`, `postHeight`, `shapeSides`, optional `originX/originY/yaw`, `postX/postY`, `extraPosts[]`, `stations[]`, `extraCameras[]`, `props[]`), `ArmInstance` (`id,label,x,y,yaw,primary?,stationId?,joints?`), `LengthUnit` (`'m'|'mm'`), `LogEntry`, `DetectedItem`, + MuJoCo WASM shims.
- **Camera presets:** `D435I_DASHBOARD_RGB_PRESET`, `D435I_RGB_640X480_PRESET`, `D435I_RGB_PRESET`, `D435I_DEPTH_PRESET`, `D435I_PRESET`.
- **Lists/defaults:** `D435I_STREAM_PROFILES`, `D435I_DEFAULT_PROFILE_ID = 'rgb-1280x720'`, `DEFAULT_CAMERA_TOGGLES`, `DEFAULT_WORKCELL_CONFIG`.
- **Helper:** `formatLen(meters: number, unit: LengthUnit): string`.

### `profiles.ts`
`LayoutProfile` (`name, savedAt, workcell, arms, camera|null, builtin?, shared?`). localStorage key `so101-layout-profiles`:
- `listUserProfiles()` — raw user-saved only.
- `listProfiles()` — user + non-overridden built-ins, tagged, newest-first.
- `saveProfile(profile)` — upsert by name; returns merged list.
- `deleteProfile(name)` — remove a user profile (built-ins immutable).

### `presets.ts`
`BUILTIN_PROFILES: LayoutProfile[]` — shipped layouts (currently empty; add via the app's Export-JSON).

### `cloudProfiles.ts`
- `fetchSharedProfiles(): Promise<LayoutProfile[]>` — team profiles; `[]` when unreachable.
- `publishSharedProfiles(profiles): Promise<boolean>` — publish; `false` when sync unavailable.

---

## 4. Pure utilities

| Helper | File | Signature | Purpose |
|---|---|---|---|
| `isPointVisibleFromSensor` | `coverage.ts` | `(point, sensorCamera, raycaster, occluders) => boolean` | In-FOV+depth **and** unoccluded test. Reuse for "would the camera see this?". |
| `matTranspose` | `MatMath.ts` | `(m, rows, cols) => Float64Array` | Transpose a flat (row-major) matrix. |
| `matMul` | `MatMath.ts` | `(A, B, m, n, p) => Float64Array` | C = A·B. |
| `matVecMul` | `MatMath.ts` | `(A, v, m, n) => Float64Array` | res = A·v. |
| `solveLinearSystem` | `MatMath.ts` | `(A_flat, b_flat, n) => Float64Array` | Solve Ax=b (Gaussian elim + partial pivot). |
| `makeCameraGlyph` | `cameraGlyph.ts` | `(scale = 1) => THREE.Group` | D435i body glyph (local −Z = optical axis). |
| `disposeGlyph` | `cameraGlyph.ts` | `(g: THREE.Group) => void` | Dispose a glyph group. |
| `CapsuleGeometry` | `CapsuleGeometry.ts` | `new CapsuleGeometry(radius, length, capSeg, radialSeg)` | Capsule mesh geometry. |
| `formatLen` | `types.ts` | `(meters, unit) => string` | Unit-aware length string. |

---

## 5. "Before you write new code" checklist

Find your need → reuse the existing thing:

- **Unit-aware numeric field / transform editor?** → `SelectionInspector`; for display strings use `formatLen`.
- **Editable panel for a selected entity?** → `SelectionInspector` driven by `SelectionController`'s `SelectionInfo`.
- **Draw a camera / camera glyph in 3D?** → `makeCameraGlyph` + `disposeGlyph` (`cameraGlyph.ts`).
- **Camera FOV/footprint/frustum/PIP/coverage?** → `WorkspaceCameraRig` (primary), `WristCamera` (gripper), `StationCamera` (fixed/extra).
- **"Would the camera see this point?" / occlusion coverage?** → `coverage.ts` `isPointVisibleFromSensor` or `WorkspaceCameraRig.computeCoverage`.
- **Reachability / where-to-mount / auto-layout?** → `WorkspacePlanner` or `MujocoSim.suggestArmLayout`.
- **IK to a point?** → `MujocoSim.moveArmTo` / `NumericIk.solve` (any arm) or `IkSystem.solve` (analytical 7-DOF). Matrix math → `MatMath.ts`.
- **Build the worktop / table / rails / post meshes?** → `BaseBuilder.rebuild(config)`.
- **Distance measurement with snapping?** → `MeasureTool`.
- **View cube / orientation / snap-to-view?** → `NavCube` + `RenderSystem.snapToView`/`orbit`/`frameView`.
- **Camera feed PIP / real-vs-sim overlay?** → `SensorView` (+ `attachPip`). Stack many via `FeedsDock`.
- **A/B comparison of setups?** → `CompareView` + `RenderSystem.renderCompareSplit` (current).
- **Right-click context / radial menu?** → `RadialMenu`.
- **Save/load/share layouts?** → `profiles.ts` (local), `presets.ts` (built-ins), `cloudProfiles.ts` (team); UI in `LayoutProfiles` / WorkspaceDock.
- **Status readout / metrics pill?** → `MetricBar`.
- **Theme / accent / dark mode?** → `TweaksPanel`; pass `isDarkMode` through.
- **Capsule geometry?** → `CapsuleGeometry`.
- **Camera intrinsics / D435i presets / default workcell?** → constants in `types.ts`.

---

### Known stale defaults (don't be misled)
- `RobotSelector` defaults `robotName` to `'Franka Panda'`, but the live app is the SO-101 twin.
- `presets.ts` `BUILTIN_PROFILES` is an empty array — there are no shipped layouts yet.
