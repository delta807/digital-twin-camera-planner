# Compare v2 — live two-cell scissor split (kill the lag, make it interactive)

## User asks (this milestone)
1. WebGL compare is laggy → render BOTH panes with the **single MuJoCo renderer** (no extra contexts).
2. Bring MuJoCo back on the compare page → **move objects + iterate** there (it's the live scene).
3. **NavCube** back on the compare page (drives shared orbit for both panes).
4. Metrics are useless → **drop them** (feeds-only).
5. Per-pane **webcam footage**: overhead D435i + wrist, **stacked**, for each side's setup.

## Architecture decision (research-backed)
- Two `THREE.WebGLRenderer` panes = the lag source. Browsers cap WebGL contexts (~8), can't share
  GPU resources across them, recompile shaders per context. Fix = **one renderer + scissor viewports**
  (react-three-scissor pattern; three.js forum consensus).
- One MuJoCo = one physics world: **one real articulated arm + one set of real task bodies**. Extra
  arms are FK ghost-clones (still joggable); the app ALREADY runs **two workstations live** (satellite
  stations: own worktop + arm + overhead cam). So "two cells in one sim" = **scissor split of the ONE
  live scene framing two cells**, NOT a physics-duplicating merge of two saved profiles.
- Compare becomes a **VIEW** over the live scene (fully editable), not a frozen snapshot.

## Plan (each phase verified in-browser before the next)

### Phase 1 — Scissor split-render in RenderSystem (the lag fix / keystone) ✓ DONE
- [x] `compareSplit` state (two cams + two targets) + renderCompareSplit() via setScissorTest/Viewport.
- [x] `setCompareSplit`/`setCompareTargets`/`clearCompareSplit` on MujocoSim. Cams share orbit, own centroid.
- [x] Verified in-browser: one canvas, two halves, 0 console errors.

### Phase 2 — Two cells live in the scene ✓ DONE
- [x] enterCompare clones primary → satellite station if none; cellCentroids() feeds targets.
- [x] Scene stays fully live/editable. NOTE: one task-body set → cell B has its own worktop+arm but
      shares the single block set (B blocks = props later if wanted).
- [x] Verified: both cells side-by-side, orbit rotates both.

### Phase 3 — NavCube on compare page ✓ DONE
- [x] NavCube already mounts in compare; transparent HUD no longer covers it. OrbitControls drive both.
- [x] Verified: drag → both panes rotate in sync (NavCube flips faces).

### Phase 4 — Per-pane stacked feeds (overhead + wrist) ✓ DONE
- [x] Cell A: rig overhead + primary wrist; Cell B: station overhead + station-arm wrist. Stacked
      tiles in the HUD, reusing wristRefCb/stationRefCb + a stable rig attach cb. Compare forces
      wrist/station PIP loops on; restores on exit.
- [x] Verified: 5 canvases (main + 4 feeds), all render, 0 console errors.

### Phase 5 — Drop metrics + cleanup ✓ DONE
- [x] Metrics removed (CompareView rewritten as transparent HUD).
- [x] Retired CompareScene3D.tsx + SceneMap.tsx (orphaned). tsc clean.
- [x] Verified exit restores single full view (1 canvas) cleanly.

## Constraints
- Never commit `.env.local`. Always `git -C .../digital-twin-camera-planner`.
- One real arm/task-body set: cell B arm is a joggable ghost; cell B blocks may be props.

## Follow-up batch (param values · cell picker · blocks-follow · per-cell props)
- [x] #1 Slider value readouts: `Sliders` now shows live value + unit (auto-precision); added units
      to station/arm/camera/prop/post X·Y·Yaw + Shape&Size (mm). Verified: "0 m / 4 / 830 mm".
- [x] #2 Compare cell picker: A/B dropdowns in the HUD list every cell (Workcell + Workstation N);
      repointing reframes that pane (compare with Workstation 3 instead of 2). State cmpCellA/B.
- [x] #3 Blocks ride the worktop: MujocoSim.transformTaskBodies (rigid translate+rotate of every
      freejoint block about the worktop pivot) + rigidProps for decoupled props; wired into
      handleStationChange (primary + station). Verified in-browser (worktop+arm+blocks move together).
- [x] #4 Per-cell props: props gained `cell?` ownership; new workstation seeds 3 cubes (cell=id) so
      Cell B isn't empty in Compare; dropped props auto-assign to nearest cell; props ride their cell.
- Research (dynamic add/delete blocks): mjModel is fixed after compile → no live body add without
  recompile. mjSpec recompile preserves state but is UNBOUND in mujoco-wasm. Standard pattern =
  pre-allocated freejoint POOL (teleport + contype/conaffinity=0 to spawn/despawn) — what robosuite/
  MJX effectively do. Props (three.js, no physics) already give instant add/delete for layout. NEXT
  option (if graspable instant blocks wanted): bake a 24-cube freejoint pool + spawn/despawn API.

## Review
Compare v2 shipped (lag fixed via one-renderer scissor split; live, NavCube, feeds, no metrics) +
this batch. All verified in-browser, tsc + build + 14 vitest + smoke green. Pushes pending user OK.
