# `/autoresearch` — scoreConfig spec (the optimizer's contract)

The optimizer turns knobs, the twin scores the result. This file defines that score:
`scoreConfig(cfg) → result`. Every term maps to a metric the twin ALREADY computes.

Goal lens: this is a **data-collection rig** for low-data manipulation learning — "optimal" means
*clean, well-perceived demonstrations of the task objects*, NOT factory throughput.

---

## 1. Input — `cfg` (the knobs the optimizer turns)

```ts
type Cfg = {
  // Table / workcell  (maps to WorkcellConfig)
  shapeSides: number;        // 3..8        → existing wc.shapeSides
  size: number;              // m, circumradius → drives wc.length/width (+ sideExtents/railLengths)
                             //   area = polygonArea(shapeSides, size); buildability = the [min,max] BOUNDS on size
  // Arms
  arms: 1 | 2;
  armBases: Array<{ x: number; y: number; yaw: number }>;   // length === arms
  // Overhead D435i
  camera: { x: number; y: number; z: number; tilt: number };
  // Where the work is + no-go areas (so we score against the REAL objects, not just a generic disc)
  taskDistribution: { kind: 'grid' | 'objects'; points?: Array<[number, number]> }; // FIXED per campaign (seeded) — see determinism note
  forbiddenZones?: Array<{ x: number; y: number; r: number }>;                       // operator space / off-limits: nothing placed here
};
```
**Determinism (critical):** `scoreConfig` MUST be deterministic — same cfg → same score. Fix the task points
(seeded) per campaign; never sample randomly inside scoreConfig, or the optimizer chases noise instead of signal.
If `taskDistribution.kind==='grid'` it's the object-zone grid (§2); if `'objects'`, score over `points` directly.
Notes
- **Buildability is NOT a separate constraint** — it's the `[min,max]` range on `size` (and on `camera.z`),
  so the optimizer only ever proposes physically-buildable tables.
- `armBases`/`camera` ranges are clamped to the table footprint + post envelope.

## 2. The "object zone" (objectives are averaged over THIS, not the whole table)

The objects you actually manipulate live in a central region, not the table edges. Define:
```
objectZone = cells within radius (ZONE_FRAC × inscribedRadius(shapeSides, size)) of the table centre
ZONE_FRAC default 0.7   // tune; or, if task objects are placed, use their footprints instead
```
All three objectives are the **mean over objectZone cells**. (Averaging over the zone, not the table,
is what keeps the score about "where the work happens.")

## 3. Objectives — maximize (each normalized 0..1, so they're comparable)

Let `dex(cell)` = inverse-condition-number dexterity ∈[0,1] (from `getManipulability`),
`grasp(cell)` = top-down graspable? (from `getReachWorld` graspable set).

**O1 · taskGrasp** — can the arm reach the work *comfortably*?
```
taskGrasp = mean over objectZone of ( grasp(cell) ? bestDex(cell) : 0 )
```
→ dexterity-weighted graspable coverage. A cell the arm can only barely stretch to scores low even
though it's "reachable". Sources: `getReachWorld` + `getManipulability`.

**O2 · perception** — can the camera *see the work sharply (RGB) AND with good geometry (depth)*?
RGB-D: both channels must be good, so perception is DUAL-CHANNEL (product, not a separate depth penalty).
```
res_rgb(cell)   = clamp01( RGB_GSD_TARGET   / gsdRGB(cell) )    // D435i RGB 1280×720, HFOV 69° → band 0.3–0.9 mm/px
res_depth(cell) = clamp01( DEPTH_GSD_TARGET / gsdDepth(cell) )  // D435i depth 848×480, HFOV 87° → band 0.6–1.9 mm/px
vis(cell)       = overhead covers cell (in-frustum AND not occluded)            // from coverageGrids overhead
perception      = mean over objectZone of ( vis(cell) ? res_rgb(cell) · res_depth(cell) : 0 )
```
Sources: `coverageGrids` (overhead) + `gsdGrid` run TWICE (RGB intrinsics 69°/1280; depth intrinsics 87°/848).
Notes:
- Bands per Intel datasheet 337029-005 (RGB floor 1080p@0.4m≈0.29 → 720p@0.85m≈0.91; depth 848×480@0.4–0.85m≈0.9–1.9).
- Depth's *effective* lateral detail is only ~3–5 mm (upscaled 720p + stereo match window), so res_depth mostly
  rewards mounting closer/less obliquely. The real depth cliff — z² accuracy (~2% of range) + grazing-angle dropout —
  lives in the `depthInRange` constraint (C2), not here. Use both: this rewards good depth sampling; C2 forbids unusable depth.

**O3 · collaboration** — (2-arm only; `null` for 1-arm so it's excluded from the Pareto front)
```
collaboration = mean over { objectZone cells reachable top-down by BOTH arms } of  min( dexA(cell), dexB(cell) )
```
→ dexterity-weighted overlap, scored by the **weaker** arm at each shared cell (a handoff spot is only
as good as the less-comfortable arm there). Sources: `getReachWorld` (≥2 arms) + per-arm `getManipulability`
(/ `getHandoff` already computes the min-of-top-two quality — reuse it).

These three TRADE OFF (lower camera → sharper but less coverage; spread arms → more reach, less overlap),
so the optimizer returns a **Pareto front**, not one winner.

## 4. Constraints — hard pass/fail (`feasible` gate; infeasible configs are discarded)

```
C1 noCollision  : no arm↔arm, arm↔table, arm↔post collision across the scored poses   (armCollides)
C2 depthInRange : objectZone within the D435i usable band (≥ ~0.17 m, not beyond reliable range / too oblique)
C3 reachable    : every designated task object is top-down graspable by ≥1 arm
C4 visible      : every designated task object is camera-covered (in-frustum, not occluded)
feasible = C1 && C2 && C3 && C4
```
If `!feasible`, the optimizer skips it (no objective scores needed) and records which constraint failed.

## 5. Penalty — torque headroom ONLY (a gentle nudge, not a goal or a gate)

```
headroom(cell) = min-over-joints torque headroom ∈[0,1]   (from getEffort; 1 = relaxed, 0 = a servo at its limit)
torqueStrain   = mean over { graspable objectZone cells } of (1 − headroom(cell))   // 0 = all relaxed, 1 = all maxed
```
Applied as a small discount to the manipulation objectives (it's about arm poses, not the camera):
```
λ = 0.2                              // small — a nudge, not a deal-breaker
O1' = O1 × (1 − λ·torqueStrain)
O3' = O3 × (1 − λ·torqueStrain)      // O2 (perception) is unaffected
```
(Multi-view-redundancy bonus and cycle-time penalty were considered and DROPPED — not worth the noise.)

## 6. Output — `result`

```ts
type Result = {
  feasible: boolean;
  failed: string[];                    // e.g. ["C3 reachable: object#2 unreachable"] when infeasible
  objectives: { taskGrasp: number; perception: number; collaboration: number | null };  // post-penalty, 0..1, maximize
  penalty:   { torqueStrain: number }; // 0..1, lower better (already folded into objectives)
  raw: Record<string, number>;         // unweighted coverage %, overlap %, mean GSD, mean headroom… for debugging
  cfg: Cfg;                            // echo, so trials are self-describing
};
```

## 7. How the optimizer consumes it
- Infeasible → drop (or assign dominated sentinel).
- Feasible → the point `(taskGrasp, perception, collaboration?)` enters the Pareto front.
- Report: non-dominated set + a knee-point "recommended config"; let the user re-weight after.

## 7b. Two loops — knobs vs objective-parameters (how we "vary" things)

There are TWO kinds of variables; never let the optimizer turn the second kind (it would game the score —
shrink the zone, loosen the GSD target, zero-out λ).

- **INNER loop (the optimizer) searches the PHYSICAL knobs** — `shapeSides`, `size`, `arms`, `armBases`, `camera` —
  for a FIXED `(ZONE_FRAC, GSD_TARGET, λ)`. Output: a Pareto front of physical setups.
- **OUTER loop (sensitivity sweep) varies the OBJECTIVE-PARAMETERS** — re-run the inner optimization at a few
  fixed values and check whether the recommended setup CHANGES:
  - `ZONE_FRAC ∈ {0.6, 0.7, 0.8}`
  - `GSD_TARGET ∈ [0.3 .. 0.9] mm/px` — the D435i's real RGB capability band (floor 1080p@0.4 m ≈ 0.3,
    ceiling 720p@0.85 m ≈ 0.9; Intel datasheet 337029-005). Stricter = physically unreachable; looser = trivially passes.
  - `λ ∈ {0, 0.2, 0.4}` — OR drop λ entirely and treat torqueStrain as a reported quantity / soft constraint that
    the Pareto knee-selection handles (preferred: no weight to guess).
  Stable winner across the sweep → robust. Winner flips → the recommendation depends on that assumption (a finding).

  **Sweep loop (per objective-parameter, e.g. ZONE_FRAC):**
  ```
  for zf in [0.6, 0.7, 0.8]:
      front[zf]  = run_inner_optimizer(ZONE_FRAC = zf)   # full physical-knob search, zf held FIXED
      winner[zf] = knee_point(front[zf])
  compare winner[0.6], winner[0.7], winner[0.8]
  ```
  - **Robust** (same shape/arms/camera, scores drift only) → ship that layout; the zone-size guess didn't matter.
  - **Sensitive** (winner flips — e.g. 1-arm+low-cam at 0.6 → 2-arm+hexagon+high-cam at 0.8) → that's the finding:
    the answer hinges on the assumption. Either pin the real value, or report conditionally ("≤0.6 → A, ≥0.8 → B").
  - Never let the OPTIMIZER turn ZONE_FRAC — it'd shrink it to a dot where everything scores ~1 (meaningless).
  - **Interaction with taskDistribution:** ZONE_FRAC only applies when `taskDistribution.kind==='grid'` (the generic
    disc). With `kind==='objects'` the objects ARE the zone — skip the ZONE_FRAC sweep and instead (optionally) sweep
    which object layouts you test (spread / clustered / two-pile).

## 8. Build order (slices)
1. **scoreConfig over the CURRENT scene** — wire the formulas to the existing getters, return `result`. (no optimizer yet)
   MUST be LEAN + headless: call the planner/camera getters DIRECTLY — do NOT trigger the analysis-panel snapshot
   (debounced/chunked, recomputes everything → far too slow for 100s of trials).
2. **Apply-a-cfg** — a headless setter that puts the twin into an arbitrary `cfg` (table/arms/camera) before scoring.
   Polygon already supported via `shapeSides`/`sideExtents`/`railLengths`. MUST `await` the rebuild + reachability
   re-sweep before reading metrics (the recompute clears `armCells` mid-flight — reading early = half-built scene).
3. **Headless harness** — expose `window.scoreConfig(cfg)` (async, awaits settle); drive via Playwright. Later: port the
   pure geometry/scoring to a faster Node/MuJoCo runner once the metrics are validated against the visual twin.
   STATUS: window.__autoresearch.scoreCurrentScene (slice 1) + applyConfig (slice 2) DONE + verified (a 1-arm apply
   correctly rebuilt the scene + recomputed + scored). ⚠ PERF: a full-fidelity applyConfig is SLOW — it does a
   relocateBase MuJoCo model reload + a 160×N³-per-arm FK reach sweep (2-arm measured >80 s). Too slow for a 200-trial
   sweep. FAST-MODE follow-up (own slice): (a) SKIP relocateBase for headless scoring — computeReachability already
   moves each base via setSweepBase (no recompile); the only cost is the primary arm's mesh staying at its old spot,
   a bounded coverage-occlusion approximation; (b) expose a reduced BASE_STEPS / coarse reach grid for autoresearch;
   (c) eventually the pure-geometry headless runner. Until then keep sweeps SMALL (handful of configs).
4. **Optimizer loop** — start dumb: grid-sweep `shapeSides × {1,2 arms}` (+ candidate arm/camera poses on mount rings/edges).
   Then Ax (qNEHVI) over the continuous knobs; keep the grid for the tiny discrete axes.

## 9. Harness layout & outputs (adopted)
```
digital-twin-camera-planner/
  autoresearch/
    types.ts          // Cfg + Result types (§1, §6)
    scoreConfig.ts    // the contract — calls existing planner/camera getters (LEAN, headless)
    candidates.ts     // polygon/table/arm-ring/camera candidate generation
    pareto.ts         // non-dominated ranking + knee-point pick
    report.ts         // results.json + pareto.csv + top-10 markdown
  scripts/
    autoresearch.mjs  // CLI runner via Playwright (window.scoreConfig)
```
CLI: `npm run autoresearch -- --campaign two-arm-polygons --n-sides 3,4,5,6,8 --arms 1,2 --trials 500 --out tasks/autoresearch_runs/run-001`
Outputs per run: `results.json` (all trials), `pareto.csv` (non-dominated set), `top10.md` (summary), and **each winning
layout saved as a twin-loadable profile** (reuse profiles.ts / LayoutProfiles) so you can OPEN the recommendation in the twin.
First-version success: evaluate 100+ layouts headlessly; emit the artifacts; save winners as profiles; answer "do 2 arms
actually beat 1 for this polygon/table?".

## Settings (resolved)
Objective-parameters — fixed per inner run, varied only by the outer sensitivity sweep (§7b):
- `ZONE_FRAC` default 0.7, sweep {0.6, 0.7, 0.8}
- `RGB_GSD_TARGET` default 0.5 mm/px, sweep 0.3–0.9 (D435i RGB capability band)
- `DEPTH_GSD_TARGET` default 1.1 mm/px, sweep 0.6–1.9 (D435i depth-848×480 capability band)
- `λ` default 0.2, sweep {0, 0.2, 0.4} — or drop it and let the Pareto knee handle torque (preferred)
Physical-knob bounds (still to pin to the real rig):
- `size` [min,max] build bounds, `camera.z` [min,max] (≥ MinZ: 0.195 m @848×480 / 0.28 m @720p depth).
