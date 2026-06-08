# ROM / collision rendering — working plan & backlog

Tracker for the digital-twin-camera-planner. Mirror into `/goal` when run.
Research basis: [placement-feedback-research.md](placement-feedback-research.md) (2026-06-08).

## Now: ROM / collision blocked-overlay polish (FOCUS)
Our reachability *model* is already state-of-the-art (forward reach map + inverse-reach
base placement + r(θ) sector + green/red convention). The gap is rendering polish of the
**blocked subset** — today `renderBlockedTiles` draws a speckle of 0.03 m red squares.

- [x] **#1 Carved blocked sector (not speckle tiles).** DONE (8a38c17). `radBlocked`
      accumulated from the same FK samples as the precision fan; filled red wedge via
      `radialFan` + `ShapeGeometry`. Verified on live sim.
- [~] **#2 Stencil-clip red overlay to the precision fan.** SUBSUMED BY #1 — because
      `radBlocked` shares the precision fan's (ang,r) samples, the wedge is nested inside
      the reach fan by construction (same bins, nested [rMin,rMax], same smoothing). No
      overhang observed top-down. GPU stencil would be invisible belt-and-suspenders +
      fragile global stencil state → SKIP unless a hard guarantee is wanted later.
- [ ] **#3 Hatch/pulse "danger" shader + fade-in on change.** ShaderMaterial on the fan
      fill (diagonal stripes / slow alpha pulse), crossfade when `armBlocked` changes. ~½ day.
- [ ] **#4 Per-arm "% blocked" badge in-scene.** We compute `lastBlocked` but only surface
      the primary arm's; store per-arm ratio, draw a small RingGeometry badge at each base
      colored by `heat()`. ~2–3h.

## Correctness fixes (this session)
- [x] **Blocked = NO collision-free grasp** (was: ANY config collides → massive over-report
      incl. far-side-of-arm red). Now a cell is blocked iff graspable but zero collision-free
      configs reach it — correct C-space-obstacle semantics. Short post (reach-over) → 0 blocked;
      tall post → clean shadow. Fixes Q1 (left-side red) + Q3 (can dodge over). (dcf5719)
- [x] **Auto-resweep on obstacle change** (debounced ~350ms). Adding/moving/resizing a mount post
      now updates the red region without the manual Recompute button. Fixes Q4. (dcf5719)
- Research: [collision-constrained-reachability-research.md](collision-constrained-reachability-research.md)
  — ReachVox (2025) does literally our FK-sweep-with-collision method + our new "blocked unless a
  collision-free config reaches it" rule, validating the approach. C-space obstacle (Lozano-Pérez)
  is the right framing: a post is a curved hole coupling all joints, NOT a per-joint limit.
  Optional future upgrade: swap hand-rolled capsule-vs-cylinder for MuJoCo `mj_ray`/contact-list
  (exact geom + self-collision, still no dynamics). Physical "arm bumps post" = `mj_step` + geom
  (teleop feature, separate from the overlay).

## More correctness + UX (this session, cont.)
- [x] **Blocked render = actual cells, not radial fan** (835f830). The carved sector starburst-ed
      for scattered blocked sets; render full-cell quads instead (solid where contiguous).
- [x] **Busy pill during the blocking FK sweep** (6a0743b) — recompute / obstacle-change / undo no
      longer look like lag. `runHeavy(msg, fn)` paints the message before the sweep.
- [x] **Phantom base→world segment fix** (48dee69). armCollides built a fake link from the world
      ORIGIN to the base; any post near (0,0) / the base-to-origin line over-blocked (post at (0,0)
      → 100% blocked). Skip the base body's own segment. Post at (0,0) 409→3 blocked. This is the
      "added a post, everything red / nothing changed" report.

## NEXT: Physical contact with the post (toggle between two modes)
User wants BOTH, with a toggle to compare. The sim ALREADY runs mj_step + position actuators (the
arm pushes cubes), so physics exists; the post just isn't a collision geom.
- [x] **Mode A — hard-clamp jog (kinematic).** DONE (effde2d). March the jogged joint from current
      → target, stop at first contact (`armCollidesLive`). March not bisect (collision is a BAND;
      bisection would teleport through). Toggle "Post contact: Off/Clamp/Physics" in the jog panel.
      Verified: Off jogs into post (1.5, colliding); Clamp stops at 0.578 (free).
- [ ] **Mode B — true physics (mj_step contacts).** Inject the post(s) as collision cylinder geoms
      in the MJCF (RobotLoader); live-sync geom_pos/geom_size to BaseBuilder (runtime edit, like
      setSweepBase — verify geom_pos editing works without reload). Drop the qpos-teleport jog →
      drive via ctrl so contacts resist. Tune actuator gains to avoid jitter. Higher risk/effort.
- [ ] **Toggle UI** (a segmented control: Off / Clamp / Physics) + plumb the mode through the jog.

## Mode B (PAUSED by user) — physics contact
- Built: mocap collider pool (RobotLoader) + sync (geom_size/mocap_pos) + ctrl-driven bounded jog
  (advancePhysicsCtrl) + toggle (Physics disabled). UNCOMMITTED WIP.
- BLOCKER: post colliders generate ZERO MuJoCo contacts in this WASM build — first as static geoms
  (compile-time broadphase not rebuilt on runtime move), then as mocap bodies (still no contact
  despite contype=1 + overlap; geom_pos local z offset not applied → geom_xpos z=0). Needs hands-on
  contact debugging. Mode A (clamp) fully works and is the recommended behaviour.

## NEXT: 3 analysis graphs (hybrid in-app panels + PNG export, LIVE layout)
- [ ] **Framework**: Analysis panel/modal + canvas figure renderer (matplotlib-ish: axes, ticks,
      colorbar, title) + per-figure "Download PNG" (canvas.toBlob). Colormap LUTs (magma/turbo/viridis).
- [ ] **Graph 2 — reachability** (data READY): expose reachCells/cellsMax; draw heatmap — white =
      unreachable, gray = reachable-not-graspable (cellsMax-only), magma 1-4 = tool-down samples/cell
      (cells); table-centre marker; "reach N% of table". BUILD FIRST.
- [x] **Graph 1 — depth map** (2e749be): overhead D435i via a linear-depth shader override (tight
      near/far), turbo + speckle + colorbar. Fixed: sync sensorCamera from its gizmo before reading.
- [x] **Graph 3 — camera coverage**: per-cell FOV+occlusion raycast for overhead/wrist/combined,
      viridis binary, % covered. overhead 80% / wrist 7% / combined 82%. DONE (this commit).
- All three render from the LIVE layout with per-figure PNG export. ✅ Feature complete.

## Backlog (parked)
- [ ] **Multi-select (pairs + contextual actions).** Cmd/ctrl-click a SECOND object, both
      outlined, contextual action bar for recognized pairs (arm+rail → snap-to-rail,
      arm+corner → snap-to-corner, camera+post → mount, post+rail → snap).
      BLOCKER found: rails/corners are NOT independently selectable today — rail meshes
      carry `userData.selectable='station'` (BaseBuilder.ts:110), so "arm+rail" needs a
      clickable rail entity first. Decide: add a `rail` selectable kind, or drive pair
      actions off the magnetic snap-target under the cursor instead of a click.
- [ ] **#4-icons (per-object cards).** Give camera / mount-post / workstation inspector
      cards the same header swatch + sub-header glyphs the arm card got (mechanical, mirrors
      the arm-card treatment in SelectionInspector.tsx). Pure UI.

## Done (this session, pushed to delta807/digital-twin-camera-planner@master)
- [x] Snap-to-rail 187°→180° via `modelForward` single base-0 FK (3de775f).
- [x] ROM regression fix — outline kinematic, obstacles via red overlay only (d595b12).
- [x] Magnetic snap glyphs while dragging (rail mid / corner / post top) (c56770f).
- [x] Magnetic snap also rotates arms perpendicular-into-rail / face-corner (b3b9487).
- [x] Deep-dive research report on placement-feedback rendering.
