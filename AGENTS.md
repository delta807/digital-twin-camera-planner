# AGENTS.md — guide for AI agents & new contributors

Read this **before** writing code in this repo. It exists to stop two failure modes:
1. **Recreating** a component/util/engine method that already exists.
2. **Regressing** the digital twin by violating one of its load-bearing invariants.

This file is the map. The deep references are [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and
[`docs/COMPONENTS.md`](docs/COMPONENTS.md). Conventions live in
[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md).

---

## 1. What this app is

The **SO-101 Digital Twin · Lab Instrument**: a browser app (React + TypeScript + Three.js +
MuJoCo-WASM) for planning a robot workcell — lay out worktop/arms/cameras, pose arms (FK/IK),
measure, compare A/B setups, run a Gemini embodied-reasoning loop, and save/sync layout profiles.
Primary robot = **SO-101**; a **Franka Panda** path is retained.

> The repo root **is** the app root (flat layout — no nested `digital-twin-camera-planner/` dir).
> `Code.md` is **stale** (describes an old Franka pick-and-place demo). Trust `docs/`, not `Code.md`.

---

## 2. Repo map (where things live)

```
index.tsx              React mount
App.tsx                THE controller — all UI state, boot, Gemini loop (~1900 lines)
index.html             importmap (CDN deps) + Tailwind Play CDN + inline theme
MujocoSim.ts           central orchestrator: physics+render loop, arms, IK, grasp
RenderSystem.ts        Three.js scene/camera/renderer; owns the camera & tool subsystems
RobotLoader.ts         fetch + patch MJCF/meshes into the WASM FS
IkSystem.ts / FrankaAnalyticalIK.ts   Franka closed-form IK
NumericIk.ts / MatMath.ts             SO-101 numeric (DLS) IK + linear algebra
SequenceAnimator.ts    Franka scripted pick-and-place
MujocoJointDrag.ts (+ vendor/URDFDragControls.js)   click-drag joint posing
SelectionController.ts                click-to-select + transform gizmos (the real one)
SelectionManager.ts / DragStateManager.ts   LEGACY / stubbed — do not build on these
BaseBuilder.ts         worktop/rails/posts/props — pure Three.js, live-editable
WorkspaceCameraRig.ts  placeable D435i sensor camera (frustum/footprint/coverage/PIP)
WorkspacePlanner.ts    reachability + base-placement (FK sweep, no IK)
WristCamera.ts / StationCamera.ts     gripper + fixed/overhead PIP cameras
MeasureTool.ts         CAD distance measurement
coverage.ts            isPointVisibleFromSensor (frustum + occlusion)
cameraGlyph.ts         shared camera glyph
types.ts               central types + camera presets + WorkcellConfig + formatLen
profiles.ts / presets.ts / cloudProfiles.ts   layout profiles (local / built-in / team sync)
rendering/GeomBuilder.ts   MuJoCo geom → Three.js mesh
utils/StringUtils.ts   getName() over MuJoCo's names buffer
components/*.tsx        all React UI (see docs/COMPONENTS.md)
netlify/functions/layouts.mts   Netlify Blobs team layout sync
test/                  Vitest unit tests (pure logic)
tests/                 Playwright smoke/e2e (note: plural)
docs/                  ARCHITECTURE.md, COMPONENTS.md, CONTRIBUTING.md
tasks/                 todo.md / lessons.md / goal.md (working notes)
```

---

## 3. Don't recreate — reuse these (quick index)

Full table in `docs/COMPONENTS.md §5`. The most-reinvented things:

| If you need… | Use (don't rewrite) |
|---|---|
| IK to a world point | `MujocoSim.moveArmTo` / `NumericIk.solve` / `IkSystem.solve` |
| Linear algebra (solve/mul/transpose) | `MatMath.ts` |
| The worktop/table/rails/post meshes | `BaseBuilder.rebuild(config)` |
| Camera FOV / footprint / frustum / coverage / PIP | `WorkspaceCameraRig`, `WristCamera`, `StationCamera` |
| "Would the camera see this point?" | `coverage.ts` `isPointVisibleFromSensor` |
| Reach map / where-to-mount / auto-layout | `WorkspacePlanner` |
| Click-to-select + move/rotate gizmo | `SelectionController` (NOT `SelectionManager`) |
| Distance measurement | `MeasureTool` |
| Length display strings (m/mm) | `formatLen` (`types.ts`) |
| A camera glyph in 3D | `makeCameraGlyph` (`cameraGlyph.ts`) |
| Save/load/share layouts | `profiles.ts` / `presets.ts` / `cloudProfiles.ts` |
| Any transform-edit panel for a selected thing | `SelectionInspector` |
| Camera intrinsics / D435i presets / default workcell | constants in `types.ts` |

Before adding a new `components/*.tsx`, scan the table in `docs/COMPONENTS.md §1` — there are already
17 components and most "I need a panel/feed/legend/menu" needs are covered.

---

## 4. Invariants — break these and you cause a regression

- **Editing the worktop/props never reloads MuJoCo.** They're pure Three.js via `BaseBuilder`. Don't
  move worktop geometry into the MJCF.
- **Base relocation is a live edit**, not a reload: `MujocoSim.relocateBase` writes `body_pos`/
  `body_quat` then `mj_forward`. Don't reload the model to move an arm.
- **Two IK paths.** SO-101 → `NumericIk` (DLS); Franka → `FrankaAnalyticalIK`/`IkSystem`. Gate on
  `MujocoSim.isFranka`; don't assume one solver.
- **Ghost (non-primary) arms are cloned geometry**, posed via the `armPoseTransforms` FK oracle — they
  are **not** independent physics chains. Per-arm joints live on `ArmInstance.joints` (React); the
  primary arm's joints live in `mjData.qpos`.
- **`mjData` is the source of truth for sim state.** React mirrors state into refs so imperative
  callbacks see fresh values; respect that pattern (see ARCHITECTURE §4) rather than reading stale
  closure state.
- **Real interaction = `SelectionController` + `MujocoJointDrag`.** `SelectionManager` and
  `DragStateManager` are legacy/stubbed — don't extend them.
- **The CSP needs `'unsafe-eval'` + `'wasm-unsafe-eval'`** (`netlify.toml`). The MuJoCo Emscripten
  module dynamically evaluates JS and compiles WASM at runtime; removing either breaks the deployed
  app (it works locally because `vite dev` doesn't serve the CSP header). Dropping the Tailwind CDN
  would **not** let you remove `'unsafe-eval'` — MuJoCo still needs it.
- **Per-frame PIP rendering hides overlay lists** for clean footage — if you add a new overlay,
  add it to the hide lists or it leaks into camera feeds/snapshots.
- **The Gemini key must never ship by default.** It's only inlined when
  `EXPOSE_GEMINI_API_KEY_TO_BROWSER='true'`. Never commit `.env.local` or a key.

---

## 5. Workflow for a change (do this every time)

1. **Locate** the feature: grep + read the owning module(s) listed in §2. Check `docs/COMPONENTS.md`
   so you reuse, not recreate.
2. **Plan** non-trivial work; keep changes minimal and scoped (see `CLAUDE.md`).
3. **Implement**, following existing patterns (imperative core, declarative React sync via refs).
4. **Verify before "done":**
   ```bash
   npm run typecheck     # tsc --noEmit
   npm test              # Vitest unit tests (pure logic)
   npm run build         # production build must succeed
   npm run test:smoke    # Playwright e2e (needs: npx playwright install chromium)
   ```
   CI runs all of these on push/PR (`.github/workflows/ci.yml`).
5. **Add a unit test** for any new pure logic (put it in `test/*.test.ts`; keep it dependency-free —
   no WebGL/WASM). Pure math, formatters, and localStorage logic are the right targets; rendering and
   physics are covered by the smoke test.
6. **Don't sweep up unrelated working-tree changes** into your commit — this repo often has concurrent
   WIP. `git add` your specific files.

---

## 6. Areas in flux (confirm current shape before relying on them)

- **A/B Compare** is being reworked from side-by-side panes (`SceneMap` / `CompareScene3D`) to a
  single split-canvas render (`RenderSystem.renderCompareSplit`) + a transparent HUD
  (`components/CompareView.tsx`). Read those files for the live shape; `SceneMap`/`CompareScene3D` may
  be removed.

When something here is wrong or stale, fix it in the same PR — keep this map honest.
