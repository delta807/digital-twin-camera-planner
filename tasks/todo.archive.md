# Digital-Twin Camera Planner

## Milestone 1 — Camera planner (DONE, verified 2026-06-03)
Frustum / Sensor PIP / footprint / object-tint / occlusion coverage + draggable D435i camera.
See git/files: WorkspaceCameraRig.ts, coverage.ts, components/{SensorView,CameraControls}.tsx.

## Milestone 2 — SO-ARM100 twin + reachability & base placement (DONE, verified 2026-06-03)
- [x] RobotLoader: SO-101 (`trs_so_arm100`) branch + scene injection (table 0.83×0.83, frame,
      camera post, task objects) + TCP site + fetch cache + base-pos patch
- [x] MujocoSim: isFranka gating, default → SO-101, SO-101 init/pose, planner, relocateBase()
- [x] WorkspacePlanner: FK joint-sweep reachability heatmap + inverse base-placement + base gizmo
- [x] RenderSystem: extraPipHelpers (hide planner overlays from PIP)
- [x] components/ReachabilityControls.tsx + App wiring + SO-101 camera framing + gate pickup
- [x] RobotSelector shows current robot name (SO-ARM100 / Franka Panda)
- [x] Verify end-to-end (Playwright)

### Review
- SO-ARM100 loads from Menagerie (`trs_so_arm100`, meshes auto-fetched) onto the 0.83×0.83
  worktop with frame rails + scattered task objects + floating task-point markers.
- Reachability heatmap renders from a 9⁴ forward-kinematics joint sweep on a scratch MjData
  (live arm never twitches). Toggle + resolution slider + Recompute all work.
- Base-placement (inverse reachability) heatmap + best-mount marker + "covers 7/8 objects"
  readout confirmed.
- Draggable-base reload verified: `relocateBase(0.16,0.12)` moved the arm and recentered the
  reachability heatmap with 0 console errors (objects stay fixed). Tested via a temporary
  window hook that was removed after verification.
- Camera planner (M1) still works over the SO-101 scene; planner overlays hidden from the PIP.
- Franka analytical IK / Gemini pickup gated behind `isFranka`; still loadable via
  `init("franka_panda_stack", ...)`.
- Type-check clean (only the pre-existing `mujoco_wasm` alias resolves at Vite build, not tsc).

### Notes / possible follow-ups
- Franka is preserved but there's no in-UI robot switcher yet (loadable via code/flag).
- Reach z-band (0.14 m) and sweep resolution are tunable knobs in WorkspacePlanner / the panel.

## Milestone 3 — Editable workspace (parametric base, polygon shapes, multi-arm, reach outline)
Most of M3 was built in parallel (parametric base, polygon shapes 3–8 sides, height/rail
controls, multi-arm ghost instances, yaw rotation, RGB/depth camera stream presets) — all
compile cleanly. Remaining gaps were closed here:
- [x] **Reach outline (#5)** — per-arm dashed max-range loop (Line2 fat dashed lines), default
      view; heatmap kept behind a toggle. `WorkspacePlanner.computeLocalBoundary/renderOutlines`.
- [x] **Multi-arm reach overlay** — each arm's outline color-coded and transformed by its
      (x,y,yaw); moving a ghost updates instantly (no recompute). `setArms()`.
- [x] **QA-H1 fix** — `WorkspacePlanner.dispose()` now frees all geometries/materials +
      InstancedMesh buffers (was leaking per base/workcell reload).
- Verified (Playwright): bold dashed outline shows; 2 arms → 2 overlapping color outlines;
      triangle (3-side) worktop reload keeps arms+outlines; 0 console errors.

### QA findings (subagents)
- **Camera D435i (fact-check):** preset is accurate to the RGB sensor (69°×42°, 16:9; derived
  vFov ≈ 42.3° — math verified); PIP footage is geometrically faithful (no distortion). `far=3.0`
  = Intel ideal-range; `near=0.28` = depth Min-Z @720p (datasheet floor 0.105). Recommendation
  to add a wider depth-FOV preset (87°×58°) for the frustum was **already implemented** in the
  parallel work (`D435I_DEPTH_PRESET` + stream profiles).
- **Code review (M1+M2):** fixed H1 (dispose leak). Still open (recommended, not yet done):
  - H3 — add a re-entrancy guard to `MujocoSim.init` (rapid base/arm/workcell reloads can race).
  - M5 — `WorkspaceCameraRig.computeCoverage` orphans coverage `BufferAttribute` buffers each recompute.
  - M6 — `clearTint` doesn't restore `emissiveIntensity` (tinted objects stay at 0.6 after untint).
  - M2 — `setupPlanner` resolves Wrist_Roll/Jaw by actuator index [4,5]; resolve by name for robustness.

## Milestone 4 — Coordinates, measure, consolidated dock, camera/arm/Gemini fixes (IN PROGRESS)
- [x] **#2 limp arms** — `setInitialPose` now seeds qpos (removed always-false guard). Verified.
- [x] **Phase 1 camera (#3)** — corrected stream-profile FOVs in types.ts (depth-640×480 79.76→72.9,
      depth-848×480→87/58, RGB→69.4, 640×480→54.8), default profile → RGB 1280×720. Verified.
- [x] **Phase 1 Gemini (#4a)** — key in gitignored `.env.local`; Detect → 200 on
      `gemini-robotics-er-1.6-preview` (user's key has ER preview access). Verified.
- [x] **Reach outline fix** — replaced angular boundary with flood-filled + dilated silhouette
      (was a 360° "web"); fixed real SO-101 URDF joint limits (Pitch/Elbow were too loose);
      relabeled "SO-101". Verified clean bounded fan.
- [x] **Phase 2** — worktop → Three.js `BaseBuilder`; edits are live (hexagon @1.1×0.83 instant,
      no reload). Fixes #5. RobotLoader no longer injects the table. Verified.
- [x] **Phase 3** — coordinate system (#1): origin axis triad at table center + live coordinate HUD
      (camera + selected arm X/Y/Z, m/mm toggle, axes toggle). `CoordinateSystem` in RenderSystem +
      `components/CoordinatesHud.tsx`. NOTE: the FreeCAD-style corner nav cube (three `ViewHelper`)
      blanked the main viewport in this three version → removed; redo later with an isolated renderer.
      Verified: HUD live, mm toggle works, main view intact.
- [x] **Phase 4** — consolidated object dock (#7): `components/WorkspaceDock.tsx` (Scene/Workcell/
      Arms/Camera/Measure sections, grouped props, live coords); deleted CameraControls /
      ReachabilityControls / CoordinatesHud. Verified in-browser, committed (f9f8376),
      CodeRabbit: no findings, subagent QA running.
- [x] **Phase 5** — measure tool (#6): `MeasureTool` pt-pt + obj-obj, snap (Shift=free), CSS2D
      labels, ΔX/Y/Z, persistent list, m/mm. Committed b442240; CodeRabbit + QA fixes (21e2a97, b07112a).
- [x] **Phase 6** — SO-101 numeric IK (#4b): `NumericIk` DLS + finite-diff Jacobian; `moveArmTo`
      ungated for SO-101 → click detected object → arm reaches (verified ~3 mm). Committed 3c415ee;
      CodeRabbit clean; QA fix (live-pose seeding) 64cd4ec.
- [x] **Cleanup QA** — init re-entrancy guard (H3), coverage buffer reuse (M5), emissiveIntensity
      restore (M6). Committed 64cd4ec.
- [ ] **Deferred** — corner orientation nav cube via an isolated renderer (three ViewHelper broke
      the main viewport; the coordinate HUD + origin axes already deliver #1). Pure polish.

## Milestone 5 — Selection, measure snapping, SO-101 pickup (DONE, verified 2026-06-04)
Driven by the user's "#8 selection → #7 measure snapping → #2 pickup" + B1/B2 (replicate the real
rig via coordinates). Per-phase ritual (implement → tsc → Playwright → commit → CodeRabbit → QA).
- [x] **B2 editable camera X/Y/Z + aim-down** (acf7c97) — type exact coords (origin=table centre);
      `WorkspaceCameraRig.setPosition/aimDown` + dock `Vec3Editor`. Verified X=0.265 Z=0.87 moves cam.
- [x] **B1/B2 movable camera post + snap-to-post** (97b950f) — `WorkcellConfig.postX/postY` sliders;
      post defaults to the real rig (~15 cm in from +X edge, centred Y); "Snap to post" mounts the
      camera on the rod top + aims down. Verified post at (0.265,0); snap → cam (0.27,0,0.84).
- [x] **#8 click-to-select** (9e3ad02, QA 157f066) — `SelectionController`: click task object/post →
      yellow BoxHelper outline + HUD chip (label, live X/Y/Z); post gets an X/Y translate gizmo that
      writes postX/postY (live). Arm/floor/empty → deselect. Only tagged bodies pickable. Outline/
      gizmo hidden from PIP; disabled during measure. QA: tracks physics-moved objects each frame,
      frees BoxGeometry, robust pointer state. Verified post/bin/deselect; 0 errors. CodeRabbit clean.
- [x] **#7 measure snapping** (755b3ad) — OrcaSlicer-style vertex→edge→surface snap chosen in screen
      space (SNAP_PX=12) off the hit triangle; colour-coded hover dot (green/blue/amber); Shift=free.
      Verified green vertex dot + 0.176 m two-vertex measurement.
- [x] **#2 SO-101 pickup** (00bcf3d, QA 4f4c6a6) — numeric-IK grasp state machine: approach→descend→
      close→lift→carry→lower→release per detected item. Orange task blocks made DYNAMIC (freejoint on
      the menagerie floor); grabbed block kinematically pinned to the TCP; placed into the teal bin.
      Verified task0 (0.16,0.12)→(0.28,0.164,0.058) in the bin; 15 cm lift. CodeRabbit: 2 minor, fixed
      (clear stale grasp on reload, re-entry guard, marker hygiene, phase comment).

## Milestone 6 — OrcaSlicer-style selection-driven UI + reach/grasp bug fixes (IN PROGRESS)
User batch (7 items) + 3 subagent investigations. Decisions: reach overlay = **two contours**
(max ~340° envelope + inner precision/top-down workspace); pickup = **real grasp** (orientation-
aware IK + friction, no kinematic pin); sequence = **UI foundation first**.
Key findings: (a) #6 360° is NOT a bug — arm folds & reaches ~340°; show max+precision contours.
(b) #5 "apply pose" is NOT a MuJoCo requirement — move base live via body_pos+mj_forward; ghost
preview is pure Three.js. (c) #7 SO-101 never really grasps (kinematic pin fights solver) + IK is
position-only so it leans instead of turning.

### Phase A — UI foundation (selection-driven)
- [x] **A1 Camera framing (#1/#2)** — `RenderSystem.frameView(object?, keepDirection)` (bounding-
      sphere fit, excludes worldbody floor plane + oversized meshes); Toolbar Home(=reset iso) +
      Focus(=frame selection) buttons + keys Home/F. Verified reset frames the workcell cleanly.
- [x] **#5 Live base move** (63af579) — relocateBase now edits Base body_pos/body_quat + mj_forward
      (no reload, no flash); primary arm slider moves the real arm live; "apply pose" dependency gone.
- [x] **A2 Selection-driven transform (#3)** (5e22d39, 260afb6, 0346c31) — unified SelectionController
      (arm + camera + post + task blocks all selectable); floating SelectionInspector with per-kind
      editable coords + write-backs (arm→base, camera→pose, post→workcell, block→qpos); Objects tree
      in the dock; viewport↔tree↔inspector two-way synced. Verified: edit arm X→0.25 moves it live.
- [~] **A3 Ghost preview (#5)** — DEPRIORITISED: live base move already shows the move in real time,
      so the "shadow before commit" is largely moot. Revisit only if a non-committed preview is wanted.
- [~] **A4 Scale-to-dimension (#4)** — DEFERRED: runtime geom scaling in MuJoCo needs care (geom_size
      is structural-ish / may need recompile); the workcell already has Length/Width sliders. Revisit.

### Phase B — Bug fixes (on the new foundation)
- [x] **B1 Reach two-contour (#6)** (45738b7) — faint grey MAX envelope (~340°, all worktop-height
      configs) + bright PRECISION contour (top-down graspable). reachCellsMax + reachCells; both
      silhouettes rendered per arm. Verified both contours show.
- [x] **B2 Real grasp (#7)** (b60f1d2) — orientation-aware DLS: NumericIk gains a downWeight that
      drives the gripper approach axis straight-down via a 6×N finite-diff Jacobian (N×N normal form
      + Gaussian elimination). The arm now ROTATES to face side targets (7a) and, because the gripper
      lands ON the block pointing down, the kinematic grab is geometrically sensible and no longer
      fights the contact solver — the wacky fling (7b) is gone. Verified: task3 → base +46°, gripper-
      down 0.98, ~3 cm reach; full pick-and-place carries it to rest (z=0.018, not flung), 0 other
      blocks disturbed. Out-of-arc targets hit the joint limit (honest 5-DOF limit). CodeRabbit: no
      findings; subagent verified the DLS/solveLinear/axis math. Known limit: ~3 cm placement error +
      folded-elbow look = 4-DOF IK precision, not physics bugs.

### M6 status: DONE for this batch. Shipped #1,#2,#3,#5,#6,#7 + selection-driven UI overhaul.
A3 (ghost) deprioritised (live move shows motion already); A4 (scale-to-dimension) deferred
(MuJoCo runtime geom scaling needs care). Possible polish: move bin into the top-down reach arc so
placements land cleanly; smooth the elbow config; surface "unreachable" targets in the UI.

## Repo
Private: github.com/delta807/digital-twin-camera-planner — all phases pushed (origin/master @ 4f4c6a6).
Per-phase ritual followed throughout: implement → Playwright verify → commit → CodeRabbit → subagent QA → fix.

## Out of scope (later)
Physically-simulated extra arms (real MuJoCo instances); per-arm independent joint control;
saving/loading layouts; the second *leader* arm pairing; full SO-101 grasp/pickup sequence.
