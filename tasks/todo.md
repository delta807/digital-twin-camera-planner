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

### Phase 4 — Per-pane stacked feeds (overhead + wrist)
- [ ] Each pane overlays its cell's overhead (station/extra cam) + that arm's wrist PIP, stacked.
- [ ] Verify: left = cell-A overhead+wrist, right = cell-B's.

### Phase 5 — Drop metrics + cleanup
- [ ] Remove MiniMetric bar + metricsFor + verdict math. Retire CompareScene3D. Slim footer.
- [ ] tsc clean, smoke green, commit + push.

## Constraints
- Never commit `.env.local`. Always `git -C .../digital-twin-camera-planner`.
- One real arm/task-body set: cell B arm is a joggable ghost; cell B blocks may be props.

## Review
(filled at the end)
