# SO-101 Digital Twin · Lab Instrument — Architecture

> A React + TypeScript + Three.js + MuJoCo-WASM single-page web app for planning a robot workcell:
> lay out a worktop, arms, and cameras; pose arms via FK/IK; measure distances; compare A/B camera
> setups; drive a Gemini embodied-reasoning loop; and save/sync layout profiles. Primary robot is
> the **SO-101** (the SO-ARM100 from MuJoCo Menagerie); it also retains a **Franka Panda** demo path.
>
> Repo root **is** the app root — everything is flat (no nested `digital-twin-camera-planner/`
> folder). The older `Code.md` (describing a "Franka pick-and-place demo") is stale; this doc
> reflects the actual current code.

---

## 1. System overview

The app boots a React tree (`index.tsx` → `App.tsx`). `App.tsx` is a single large controller
component (~1900 lines) that owns all UI state and holds a `MujocoSim` instance in a ref.
`MujocoSim` is the imperative core orchestrator: it wires the MuJoCo WASM physics engine to a
Three.js render/scene layer (`RenderSystem`) and to a set of focused subsystems (IK, joint drag,
camera rig, workspace planner, measure, base/worktop builder, selection). The physics+render loop
runs inside `MujocoSim.startLoop()` via `requestAnimationFrame`; React syncs with it through refs,
imperative method calls, and a separate UI-only `requestAnimationFrame` loop in `App.tsx` that reads
HUD values back out. External services: the **Gemini API** (called directly from the browser in
`App.tsx.handleErSend`), a **Netlify Blobs** serverless function for team layout sync, and **remote
MJCF/mesh assets** fetched from GitHub (mujoco_menagerie) into the WASM virtual filesystem.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ React UI layer  (components/*.tsx)                                             │
│  ModeRail · UnifiedSidebar · WorkspaceDock · SelectionInspector · SensorView   │
│  FeedsDock · CompareView · LayoutProfiles · NavCube · Toolbar · MetricBar      │
│  OverlayLegend · RadialMenu · TweaksPanel · RobotSelector                      │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                 │  React state ↕ refs / imperative method calls
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ App.tsx  (controller — owns all useState; holds simRef: MujocoSim)             │
│   boot effect → loadMujoco() → new MujocoSim → sim.init("so_arm100")           │
│   Gemini ER loop · profile load/save/sync · UI rAF loop (HUD readback)         │
└───────────────────────────────┬──────────────────────────────────────────────┘
                                 │
┌───────────────────────────────▼──────────────────────────────────────────────┐
│ MujocoSim  (central orchestrator — the physics+render loop)                    │
│   owns mjModel / mjData / mjvOption · startLoop() rAF · scripted grasp SM      │
└──┬───────────────────────────────────────────────────────┬───────────────────┘
   │                                                         │
┌──▼─────────────────────────┐                  ┌───────────▼──────────────────┐
│ RenderSystem (Three.js)    │                  │ Robotics / Control            │
│  scene·camera·OrbitControls│                  │  IkSystem (Franka analytical) │
│  bodies[]·simGroup·erGroup │                  │  NumericIk (SO-101 DLS)       │
│  planningArmsGroup (ghosts)│                  │  FrankaAnalyticalIK · MatMath │
│  GeomBuilder · Reflector   │                  │  SequenceAnimator (Franka SM) │
└──┬─────────────────────────┘                  │  MujocoJointDrag (+vendor)    │
   │ subsystems owned/created by RenderSystem    │  DragStateManager (stub)      │
   │   WorkspaceCameraRig (placeable D435i)      └───────────────────────────────┘
   │   BaseBuilder (worktop/rails/post/props)
   │   WristCamera · StationCamera (PIP feeds)   ┌───────────────────────────────┐
   │   MeasureTool · SelectionController         │ Data / Utils                  │
   │   WorkspacePlanner (reach/base placement)   │  types · profiles · presets   │
   └─────────────────────────────────────────────  cloudProfiles · coverage     │
                                                 │  cameraGlyph · StringUtils    │
┌──────────────────────────┐  ┌──────────────┐  └───────────────────────────────┘
│ MuJoCo WASM (mujoco-js)  │  │ Three.js     │
│  mj_forward / mj_step    │  │ WebGLRenderer│   External services:
│  in-memory FS (/working) │  │ + CSS2D      │    • Gemini API  generativelanguage.googleapis.com
└──────────────────────────┘  └──────────────┘    • Netlify fn  /.netlify/functions/layouts (Blobs)
                                                   • MJCF assets raw.githubusercontent.com (menagerie)
```

---

## 2. Boot / data flow

1. **Mount.** `index.tsx` creates a React root and renders `<App/>` in `React.StrictMode`.
   `index.html` supplies an **importmap** that resolves all bare specifiers from CDNs (esm.sh for
   React/genai/uuid/lucide, unpkg for `three@0.164.1` core + `mujoco-js@0.0.7`, esm.sh for `three/`
   subpaths at 0.181). Tailwind is loaded via the **Play CDN** (`cdn.tailwindcss.com`) with an
   inline OKLCH "lab-instrument" theme override. (Note: the Vite production build bundles its own
   deps; the importmap is primarily for the AI-Studio no-build path.)

2. **MuJoCo WASM load.** First `useEffect` in `App.tsx` calls `loadMujoco({ locateFile })`, pointing
   the `.wasm` fetch at `unpkg.com/mujoco-js@0.0.7/dist/mujoco_wasm.wasm`. On success it stores the
   module in `mujocoModuleRef` and sets `mujocoReady`.

3. **Sim construction.** Second effect (gated on `mujocoReady`) disposes any prior sim, constructs
   `new MujocoSim(container, mujocoModule)`, applies dark mode, sets `onSceneReload`, then calls
   `sim.init("so_arm100", "scene.xml", onProgress, {x,y,yaw}, workcellConfig)`.

4. **Asset fetch into WASM FS.** `MujocoSim.init` instantiates a `RobotLoader` and calls
   `loader.load(...)`. `RobotLoader`: recreates `/working` in the Emscripten `FS`; maps the robot id
   to a Menagerie folder (`so_arm100 → trs_so_arm100`, `franka_panda_stack → franka_emika_panda`);
   BFS-downloads `scene.xml` and every `<include/mesh/texture/hfield>` dependency (cached in a static
   `fileCache` so base-relocation reloads don't re-hit GitHub); and **patches** XML on the way in
   (`patchSingleRobot`): injects a `tcp` site on the SO-101 `Fixed_Jaw`, optionally rewrites the
   `Base` body pose for relocation, and injects task objects (`task0…task7`). The worktop itself is
   **not** injected into MuJoCo — it is drawn by `BaseBuilder` in Three.js.

5. **Model compile.** `MujocoSim` calls `mujoco.MjModel.loadFromXML('/working/scene.xml')` +
   `new mujoco.MjData(model)`; resolves the `tcp` site id; sets the initial pose (Franka home, or the
   SO-101 rest pose from `localStorage['so101-rest-qpos']` / `SO101_FACTORY_REST`); runs
   `mj_forward`; builds the Three.js scene (`renderSys.initScene` → `GeomBuilder.create` per geom);
   and for the SO-101 rebuilds the worktop (`baseBuilder.rebuild`) and stands up the
   `WorkspacePlanner` + `NumericIk` (`setupPlanner`).

6. **Loop.** `startLoop()` schedules a `requestAnimationFrame` loop that each frame: updates drag
   state; ticks the active animator (`SequenceAnimator` for Franka, or the SO-101 scripted grasp
   `tickSo101Pickup`); steps physics in a `while` loop until sim-time advances `1/60 ·
   speedMultiplier`; pins any grabbed block; then calls `renderSys.update(mjData, …)` which syncs
   body transforms from `mjData.xpos/xquat`, renders the main view, then renders every PIP/overlay.

7. **React ↔ core sync.** `MujocoSim`/subsystems are the source of truth for sim state; React reads
   back through (a) a UI-only rAF loop in `App.tsx` that polls `getGizmoStats()` and the sensor
   camera position into HUD state, and (b) callbacks (`onSceneReload`, `selection.onChange`,
   `measureTool.onChange`, `onGhostPosed`, planner `onRelocate`, …). React pushes into the core
   imperatively (`setArmInstances`, `setWorkcell`, `relocateBase`, `setPoseMode`, camera rig
   `setToggles/setIntrinsics`).

---

## 3. Core modules

### Entry / Controller
- **`index.tsx`** — React 19 mount point.
- **`index.html`** — importmap (CDN deps), Tailwind Play CDN + inline OKLCH theme, fonts,
  `.glass-panel` styling, `#root`.
- **`App.tsx`** — the single controller component. Owns ~80 `useState`/`useRef` hooks (loading,
  `mode`, arms, `workcellConfig`, camera toggles/intrinsics/profile, selection, measurements,
  profiles, MJPEG overlay streams, planner toggles…). Hosts the boot effects, the Gemini ER loop
  (`handleErSend`), scripted pickup (`handlePickup`), marker-click → IK (`handleClick`), and renders
  all `components/*`. `GEMINI_API_KEY = process.env.API_KEY` (injected by Vite, blank unless
  `EXPOSE_GEMINI_API_KEY_TO_BROWSER=true`).

### Sim + Render core
- **`MujocoSim.ts`** — central orchestrator. Owns `mjModel`/`mjData`/`mjvOption` and constructs/holds
  `RenderSystem`, `IkSystem`, `DragStateManager`, `SelectionManager`, `SequenceAnimator`, plus
  (SO-101) `WorkspacePlanner`, `NumericIk`, `MujocoJointDrag`. Key methods: `init()`,
  `setupPlanner()`, `startLoop()`, `relocateBase()` (LIVE base move via `body_pos`/`body_quat` +
  `mj_forward`, no reload), `setWorkcell()`, `setArmInstances()`, `moveArmTo()` (numeric IK),
  `pickupItems()`/`tickSo101Pickup()` (7-phase grasp SM), `armPoseTransforms()` (FK oracle for ghost
  arms), `refreshGhostArms()`, rest-pose persistence. `isFranka` switches between the analytical-IK
  path and the SO-101 numeric/planner path.
- **`RenderSystem.ts`** — owns the Three.js `scene`, `WebGLRenderer` (shadows,
  `preserveDrawingBuffer`), Z-up camera, `OrbitControls`, a `CSS2DRenderer`,
  `simGroup`/`erGroup`/`planningArmsGroup`, `bodies[]` (one Group per MuJoCo body, tagged
  `selectable`), grid, origin axes. Creates & owns the workcell/camera/tool subsystems. `update()`
  runs every frame; also ghost-arm machinery, `frameView`/`snapToView`/`orbit`/`moveCameraTo`,
  `project2DTo3D` (Gemini 2D→3D), `getCanvasSnapshot`, ER markers, dark mode.
- **`rendering/GeomBuilder.ts`** — one MuJoCo geom → one Three.js mesh; quat conversion; the floor
  plane becomes a `Reflector`.
- **`Reflector.ts`** — mirror material for the floor. **`utils/StringUtils.ts`** — `getName` decodes
  MuJoCo's `names` buffer. **`CapsuleGeometry.ts`** — capsule geom. **`mujoco_wasm.d.ts`** — WASM
  loader typing.

### Robotics / Control
- **`IkSystem.ts`** — Franka analytical IK driver (target gizmo + q7 redundancy resolution).
- **`FrankaAnalyticalIK.ts`** — closed-form 7-DOF Panda IK.
- **`NumericIk.ts`** — SO-101 robot-agnostic numeric IK (finite-difference Jacobian + damped
  least-squares) using the MuJoCo model as an FK oracle on a scratch `MjData`; never disturbs the
  live arm.
- **`MatMath.ts`** — small dense linear-algebra helpers (transpose/mul/matvec/solve).
- **`SequenceAnimator.ts`** — Franka scripted pick-and-place state machine.
- **`MujocoJointDrag.ts`** (+ `vendor/URDFDragControls.js`) — click-drag joint posing (vendored
  `PointerURDFDragControls`, rebound to pointer events).
- **`DragStateManager.ts`** / **`SelectionManager.ts`** — legacy/stubbed; real interaction is
  `SelectionController` + `MujocoJointDrag`.

### Workcell / Camera
- **`BaseBuilder.ts`** — renders the worktop(s)/rails/posts/props/stations as **pure Three.js** from
  a `WorkcellConfig`, fully live-editable with no MuJoCo reload.
- **`WorkspaceCameraRig.ts`** — the placeable D435i "sensor camera": draggable gizmo, frustum
  wireframe, footprint, occlusion-aware coverage grid, optional depth-colormap PIP.
- **`WorkspacePlanner.ts`** — SO-101 reachability + base-placement from one FK joint sweep (reach
  heatmap, precision fan, inverse base-placement scoring, greedy multi-arm `suggestArmLayout`).
- **`WristCamera.ts`** / **`StationCamera.ts`** — gripper-mounted and fixed/overhead PIP cameras.
- **`coverage.ts`** — `isPointVisibleFromSensor(...)` frustum + occlusion test.
- **`cameraGlyph.ts`** — shared D435i glyph (local −Z = optical axis).

### Tools
- **`MeasureTool.ts`** — CAD-style point/object distance with vertex/edge/surface snapping + CSS2D
  labels.
- **`SelectionController.ts`** — OrcaSlicer-style click-to-select with bbox outline + a shared proxy
  `TransformControls` gizmo per entity kind (`post|object|arm|camera|station|wristcam|prop`); emits
  `SelectionInfo`.

### Data / Utils
- **`types.ts`** — central types/constants: camera intrinsics + D435i stream presets,
  `WorkcellConfig` (+ `DEFAULT_WORKCELL_CONFIG`), `ArmInstance`, `LengthUnit`/`formatLen`,
  `LogEntry`/`DetectedItem`, MuJoCo WASM shims.
- **`profiles.ts`** — `LayoutProfile` + localStorage CRUD (key `so101-layout-profiles`); merges user
  profiles with bundled built-ins.
- **`presets.ts`** — `BUILTIN_PROFILES` (currently empty placeholder).
- **`cloudProfiles.ts`** — thin same-origin client for the Netlify layout-sync function; fails soft
  under plain `vite dev`.

> **Compare view (in flux):** the A/B "compare two setups" feature is being reworked from
> side-by-side SVG/WebGL panes (`SceneMap` / `CompareScene3D`) to a single split-canvas render
> (`RenderSystem.renderCompareSplit`) with a transparent HUD overlay (`components/CompareView.tsx`).
> When in doubt, read `CompareView.tsx` + `RenderSystem` for the current shape.

---

## 4. State management & sync

Three stores, each with a single source of truth:

| Store | Source of truth | How others read it |
|---|---|---|
| **Physics / sim state** (joint angles, body poses, task blocks) | `mjData` (qpos/ctrl/xpos/xquat) in the WASM heap | `RenderSystem.syncBodiesFromData(mjData)` copies `xpos`/`xquat` into `bodies[i]` each frame; planner/IK/wrist-cam read `site_xpos`/`xpos` directly |
| **Three.js scene graph** (camera, gizmos, outlines, overlays, worktop, ghosts) | the Three.js objects | rendered every frame; subsystems mutate their own objects in `update()` |
| **React UI state** (mode, arms, workcell, toggles, selection, measurements, profiles) | `App.tsx` `useState` | pushed into the core via imperative calls; mirrored into refs so imperative callbacks see fresh values |

Per-frame sync (in `MujocoSim.startLoop` → `RenderSystem.update`): step physics →
`syncBodiesFromData` → render main view → render PIPs (each hides overlay lists for clean footage) →
`selection.update()` → `cssRenderer.render`. React→core is one-directional command flow; core→React
flows back through callbacks + the dedicated HUD rAF poll. Per-arm joint angles live on
`ArmInstance.joints` (React) and are reconstructed for rendering via the `armPoseTransforms` FK
oracle; the primary arm's joints live in `mjData.qpos`.

---

## 5. External integrations

- **Gemini ER loop** — `App.tsx.handleErSend`: snapshot the canvas (`getCanvasSnapshot`, ≤640 px,
  PNG), call `@google/genai` in-browser (`generateContent`, default model
  `gemini-robotics-er-1.6-preview`), parse JSON detections, project each back into 3D via
  `RenderSystem.project2DTo3D` to drop ER markers; clicking a marker triggers IK reach. Host:
  `generativelanguage.googleapis.com` (CSP `connect-src`).
- **Netlify Blobs layout sync** — `cloudProfiles.ts` ↔ `netlify/functions/layouts.mts` (Blobs store
  `so101-layouts`, key `shared-layout-profiles`). GET returns `{ profiles }`; POST validates, caps to
  100, tags `shared:true`. Served at `/.netlify/functions/layouts`.
- **Remote MJCF assets** — `RobotLoader` fetches from
  `raw.githubusercontent.com/google-deepmind/mujoco_menagerie/main/<robot>/` into `/working`.
- **importmap / CDN deps** (`index.html`) — React/genai/uuid/lucide/react-markdown via esm.sh;
  `three@0.164.1` core + jsm via unpkg; `three/` subpaths via esm.sh@0.181; `mujoco-js@0.0.7` via
  unpkg; Tailwind via cdn.tailwindcss.com. `vite.config.ts` aliases `mujoco_wasm → mujoco-js/...`
  and `@ → repo root`.
- **Jetson MJPEG overlays (optional)** — the Feeds UI can superimpose live
  `http://100.68.215.10:8088/scene.mjpg` + `/wrist.mjpg` over the sim PIPs (CSP `img-src` allows that
  host).

---

## 6. Build & deploy

- **Build** — Vite 6 + `@vitejs/plugin-react`. Scripts: `dev` (port 3000), `build` → `dist/`,
  `preview`, `typecheck` (`tsc --noEmit`), `test`/`test:unit` (Vitest), `test:smoke` (Playwright).
  `vite.config.ts` injects `process.env.API_KEY`/`GEMINI_API_KEY` from `.env`, **blank unless
  `EXPOSE_GEMINI_API_KEY_TO_BROWSER='true'`** (so the key isn't shipped by default).
- **Netlify** (`netlify.toml`) — `build.command = npm run build`, `publish = dist`,
  `functions = netlify/functions`, Node 20. `[dev]` proxies Vite (3000) + functions on `:8888`. SPA
  fallback redirect `/* → /index.html 200`. Security headers on `/*`: a **CSP** that must allow
  **`'unsafe-eval'` + `'wasm-unsafe-eval'`** (the MuJoCo Emscripten module dynamically evaluates JS
  *and* compiles WASM at runtime) and `'unsafe-inline'` script (Tailwind Play CDN), whitelisting the
  CDNs, Gemini, GitHub raw, and the Jetson host; plus `Permissions-Policy`, `Referrer-Policy`,
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`.
- **Tailwind** — loaded at runtime via the Play CDN with inline `tailwind.config` (OKLCH slate/indigo
  ramp, IBM Plex fonts, categorical overlay colors). No PostCSS step; `index.css` is empty.

**Key invariants for navigators:**
- The worktop/props are Three.js-only — **editing them never reloads MuJoCo**.
- **Base relocation** is a live `body_pos`/`body_quat` edit + `mj_forward`, not a reload.
- SO-101 uses **numeric DLS IK** (`NumericIk`); Franka uses **closed-form** (`FrankaAnalyticalIK` /
  `IkSystem`).
- **Ghost (non-primary) arms** are cloned geometry posed via the `armPoseTransforms` FK oracle, not
  separate physics chains.
- `DragStateManager` / `SelectionManager` are **legacy/stubbed** — real interaction is
  `SelectionController` + `MujocoJointDrag`.
- The CSP `'unsafe-eval'` cannot be removed by dropping the Tailwind CDN — **MuJoCo's Emscripten glue
  needs it regardless**.
