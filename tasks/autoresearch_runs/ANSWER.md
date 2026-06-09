# /autoresearch — the answer (capstone #A3)

**Question:** for the SO-101 + D435i cell, what is the optimal physical setup — polygon shape,
where to clamp the arm(s), 1-vs-2 arms, build-area size, and overhead-camera pose — to service
pick-and-place objects across the workspace (centre + corners)?

**Method.** `campaign_a3.json` = 480 candidates (shapes 4/5/6 × sizes 0.40/0.50 m × 1/2 arms ×
near-vertex edge mounts 0.25/0.75 × camera heights 0.70/0.85 × tilts 0/20°). Each candidate is
applied once in the live twin (headless Playwright) and scored under 7 object regions (centre +
each corner): **2944 region-trials**. Per-region Pareto front + knee, full-fidelity re-score of
finalists, and a GSD/λ outer-sweep robustness check. A focused follow-up (`campaign_cam.json`,
30 candidates) brackets camera height 0.45–0.85 m. Artifacts: `full_a3/`, `cam_bracket/`.

---

## The recommendation (single buildable rig)

> **Two SO-101 arms clamped on OPPOSITE edges of a ~0.40 m (circumradius) polygon, near the
> shared vertices; one overhead D435i at the table centre, nadir (tilt 0°), mounted AS LOW as the
> FOV allows (~0.45–0.50 m over a 0.40 m table).**

Polygon shape is a near-tie (square ≈ pentagon ≈ hexagon, within scoring noise) — pick the shape
that's easiest to fabricate/clamp; a **square at r0.40** is the simplest and wins the centre region.

Why each knob lands where it does:

### Arms: 2 — but for COVERAGE, not collaboration
- **Centre objects are infeasible with 1 arm** (0 of 240 single-arm centre trials feasible). A lone
  arm on one edge sits at the far edge of its reach for centre objects and fails the ≥50%-of-blob
  grasp constraint. **Two arms on opposite edges** make the centre reachable.
- **At every corner, 1-arm and 2-arm score identically** (taskGrasp/perception match to 3 d.p.;
  largest gap is corner-3, 0.173 vs 0.174). The far arm cannot reach a corner; only the near arm
  services it. The two arms **partition** the workspace.
- **Collaboration is ≈0 for the winners, not structurally absent.** Across the campaign 37 trials
  show nonzero shared-dexterity collaboration (max 0.132), concentrated at the **centre** (31 of
  them — it's where both arms can overlap). But collaboration never makes a config a winner:
  taskGrasp+perception dominate, and the centre winner's 2nd arm doesn't instantiate (collab=null).
  So the practical reading holds — on this opposite-edge footprint the arms partition rather than
  collaborate — but "no shared dexterity anywhere" would overstate it.
- ⇒ Use 2 arms because the centre is otherwise unreachable and they jointly cover all corners. Do
  **not** bank on strong dual-arm collaboration on this footprint — it's mostly redundancy/partition.

### Build area: smaller is better — r0.40 m
- r0.40 wins all regions but one (corner-2 marginally prefers r0.50). Smaller circumradius keeps
  objects in the arms' serviceable mid-field; r0.50 pushes the rim toward the near-field where a
  top-down SO-101 grasp degrades. Keep the bench as small as the task allows (~0.40 m).

### Camera: nadir, as low as FOV permits (~0.45–0.50 m)
- Perception rises **monotonically** as the camera descends — pc 0.31 @0.85 m → 0.52 @0.65 →
  **1.00 @0.45** (GSD ceiling saturated). It's a pure RGB/depth-sharpness lever.
- Camera height has **no effect on grasp feasibility** (taskGrasp constant across all heights).
- ⇒ Mount the overhead D435i straight-down at the centre, as low as framing allows. ~0.45–0.50 m
  over a 0.40 m table already saturates RGB+depth GSD; higher only sacrifices sharpness. The main
  run's "z0.70" winner was boundary-hugging (0.70 was the sweep floor) — the bracketing run shows
  the real optimum is lower.

---

## Per-region winners (full_a3/summary.md)

| Region   | Best polygon | Arms | Camera | taskGrasp | perception | collab |
|----------|--------------|------|--------|-----------|------------|--------|
| centre   | 4-gon r0.40  | 2    | z0.70 t0° | 0.307 | 0.450 | null |
| corner-1 | 6-gon r0.40  | 2    | z0.70 t0° | 0.251 | 0.398 | 0.000 |
| corner-2 | 5-gon r0.40  | 2    | z0.70 t0° | 0.219 | 0.397 | 0.000 |
| corner-3 | 4-gon r0.40  | 1    | z0.70 t0° | 0.177 | 0.401 | — |
| corner-4 | 6-gon r0.40  | 1    | z0.70 t0° | 0.267 | 0.401 | — |
| corner-5 | 6-gon r0.40  | 2    | z0.70 t0° | 0.190 | 0.397 | 0.000 |
| corner-6 | 6-gon r0.40  | 2    | z0.70 t0° | 0.230 | 0.397 | 0.000 |

Shape varies by region but the score deltas between shapes are <0.02 (within noise); the robust,
single-rig reading is the recommendation above. Winning layouts are saved as twin-loadable Cfg at
`full_a3/winner-<region>.json` (→ #A4 will load these into the UI).

## Robustness
All region winners stay **feasible in 4/4 GSD/λ settings** (D435i rgb-tight/mid/loose bands + a
no-torque variant). taskGrasp is GSD-invariant (as expected); perception scales with the GSD
target; dropping the torque penalty (λ=0) nudges taskGrasp up slightly. The recommendation is not
an artifact of one objective-parameter choice.

## Data provenance & artifacts (read before trusting a single number)
- **Two fidelities.** `results.json` tags each trial `fidelity: 'fast'|'full'`. The triage majority
  is `'fast'` (coarse reach/manip); only the per-region Pareto **finalists** are re-scored at
  `'full'` fidelity, and the reported winners/table come from those `'full'` entries. To reproduce
  the table, recompute the front from the `'full'`-tagged trials — `'fast'` taskGrasp runs lower
  (coarser sweep), so it will not match. (Earlier this gap was silent; the runner now persists the
  full-fidelity finalists back into `results.json`.)
- **Region denominators are geometric, not truncation.** corner-k only exists for polygons with ≥k
  corners, so corner-5 (352 trials) draws only from n=5,6 candidates and corner-6 (192) only from
  n=6. Squares contribute 4 corners, pentagons 5, hexagons 6 — the smaller counts are expected.
- **First-apply camera race (found + fixed).** Exactly `workers` candidates per run (the first
  applyConfig on each fresh worker page) had their camera clobbered to the built-in IRL-layout
  preset (z≈0.98) by an async startup profile-load that fires after the readiness gate. That's why
  the QA saw 14/210 = 2 workers × 7 regions in the 2-worker cam_bracket. It biases *against* low
  cameras (logs 0.98 instead of the requested low z), so "lower is better" is conservative, never
  inflated, and the z0.70 winners (which read correctly) are unaffected. Fixed with a discarded
  warm-up apply in the CLI's `newReadyPage` (verified: post-warm-up, a z=0.45 request sticks at
  0.45). NB: the committed `full_a3/` was produced *before* this guard, so up to 3 of its 480
  candidates carry a preset camera — none are winners.

## Caveats / honest limits
- Camera optimum is bounded by the sweep range and the FOV-framing limit, not solved to a hard
  floor; ~0.45 m saturates GSD for r0.40 — re-bracket if the table grows.
- corner-feasibility depends on near-vertex mounts (edge-frac 0.25/0.75); midpoint mounts
  (edge-frac 0.5) leave corners unreachable — see cam_bracket corner-1 (0/6 feasible by design).
