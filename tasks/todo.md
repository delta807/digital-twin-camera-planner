# TODO — 4-item batch (Jun 2026)

(Prior milestones archived in todo.archive.md.)

User decisions: order = ROM→superimpose→design→multi-arm · multi-arm = staged (physics+IK first)
· reference img = capture from live Jetson · design = FULL reskin.

## Phase 1 — ROM fan fix (radial r(θ) reach) ← IN PROGRESS
Root cause (subagent): grid-march (9⁴ sweep) + weak R=2 morph-close + buggy chainLoops/Chaikin →
fragmented, self-crossing, non-fan. Fix = change representation to a radial profile.
- [ ] Sweep base-rotation joint finely (BASE_STEPS) × other joints (resolution); per angular bin
      record min/max reach radius for MAX set + PRECISION (top-down) set.
- [ ] Build the fan loop directly from r(θ): outer arc (rMax) forward + inner arc (rMin) back,
      opening at the largest angular gap (sector) or two rings if it wraps fully. Guaranteed clean.
- [ ] Keep reachCells/reachCellsMax (cells) for base-placement + layout set-cover (unchanged).
- [ ] Remove computeLocalSilhouette morphology + chainLoops (dead). Keep chaikin (light smooth).
- [ ] tsc → Playwright verify clean fan (1 + 2 arms) → commit.

## Phase 2 — Camera superimpose vs live Jetson
- [ ] Place overhead D435i at (0.415, 0.265, 0.85) m = (41.5, 26.5, 85) cm.
- [ ] Capture a frame from the live Jetson dashboard (Tailscale 100.68.215.10, user jetson) → overlay
      on the sim Sensor PIP with opacity/blend slider + alignment guides, to tune sim cam to match.

## Phase 3 — Full reskin to the "lab-instrument" design (from zip)
- [ ] Adopt OKLCH token system + IBM Plex Sans/Mono + dark/light + density toggle.
- [ ] Categorical overlay colors (cam=amber, reach=violet, precision=cyan, object=terracotta) + Legend.
- [ ] Left mode-rail (Edit / Compare A·B / dock / perceive), live-metrics top bar, NavCube.
- [ ] Compare A/B mode (two camera setups + coverage/reach metrics + verdict). Tweaks panel.
- [ ] Restructure shell to match mockup; keep real MuJoCo/Three.js viewport + PIPs.

## Phase 4 — Staged multi-arm physics (physics + IK first)
- [ ] Load N real SO-101 arms into one MuJoCo model (namespaced joints/actuators).
- [ ] Per-arm numeric IK + reach; arms move/reach independently. (Pickup + Gemini control = later.)

## Review
(to be filled per phase)
