# Goal — running backlog for the SO-101 digital-twin

The persistent "keep working on these" list. Per-item ritual: implement → tsc →
Playwright verify → commit (verify no `.env.local`) → CodeRabbit → subagent QA → fix.
Always `git -C /Users/laptop/Projects/lerobot/digital-twin-camera-planner` (CWD drifts).

## North star
A camera/arm/workcell planner whose sim decisions transfer 1:1 to the physical
SO-101 + D435i + Jetson rig — so layout, reach, camera placement, and grasps
chosen in sim hold up in the real world.

## AUTORESEARCH — ACTIVE FOCUS (Jun 2026)
North star: **empirically find the OPTIMAL physical setup** — where to clamp arms on the polygon, which
polygon shape, 1-vs-2-arm arrangement, and camera pose — by sweeping configs in the twin and ranking a
Pareto front per object region. Spec: tasks/autoresearch_scoreconfig.md. CLI: `npm run gen-campaign` →
`npm run autoresearch -- --manifest …`.

Everything is CODE-SWEPT — no hand inputs: object-pos = regions (centre + N corners), build-area =
`sizes` axis, GSD = the D435i's own RGB (~0.5 mm/px) + depth (~1.1) values. The optimizer searches the
physical knobs (arm bases, polygon shape, camera pose); the outer sweep iterates regions (+ later GSD/λ).

DONE: scorer (3 objectives + constraints + torque), applyConfig, fast triage→full verdict, region-blob
zones, depth-GSD channel, manifest generator (interleaved), parallel CLI, min-dex collaboration,
on-table collision, save winner-as-profile. A 30-config dry-run ran: 2-arm wins every feasible region,
5-gon edges out, but 4/6 corners came up infeasible (see #A1).

- [x] **#A1 Corner feasibility** — DONE (1c5f5be + QA 605fc98). Investigation: corners weren't a placement
      bug but a near-FIELD reach limit (a 0.6·size corner blob maxes ~38% graspable; centre 72%). Fixes:
      finer along-edge placements (edgeFracs [0.2,0.5,0.8]) + corner blobs inset to 0.45·size (serviceable
      mid-field). QA caught a 90° polygon-orientation mismatch vs the builder (only showed on n≠4) — fixed
      with a shared VERTEX_PHASE=−π/2. Verified on pentagon: all 6 regions feasible. Finding: optimal arm
      count varies by region (centre wants 2 arms; some corners want 1).
- [ ] **#A2 Build-area + GSD as explicit code sweeps** — confirm `sizes` (build area) sweeps in the
      generator; add an OUTER sweep over GSD targets across the D435i RGB (0.3–0.9) + depth (0.6–1.9)
      bands (and λ), re-ranking per setting → robustness. No user inputs.
- [ ] **#A3 Full campaign + the answer** — run the real campaign (finer placements, sizes, all shapes,
      regions) and write the optimal: best polygon, arm clamp positions, 1-vs-2, camera pose, per region.
- [ ] **#A4 (nice-to-have) UI import** of `winner-<region>.json` so a winning layout loads in the twin.

## ACTIVE — new issues (reported Jun 2026, this batch)
- [x] **#1 Joint jog doesn't respond to real clicks** — FIXED (29520b5): rewired the vendored
      controls to POINTER events (OrbitControls' preventDefault on pointerdown was suppressing the
      legacy mousedown). Verified: pointer drag rotates Pitch/Elbow.
- [x] **#2 A slider crashes / lags the whole site** — FIXED (29520b5): the arm X/Y/Yaw sliders
      re-swept reachability every tick via applyPlannerState; reach is base-relative-invariant so
      relocateBase already redraws. Dropped the redundant recompute. Verified: 40 ticks, rAF 6ms.
- [x] **#3 Wrist cam on ADDITIONAL (ghost) arms is bad** — FIXED (2c91aa9): ghosts were frozen at
      the home pose (wrist cams stared at the horizon). Now ghosts re-mirror the primary's CURRENT
      pose on jog-end (refreshGhostArms), so wrist cams frame consistently; ghosts no longer inherit
      the pink hover highlight.
- [x] **#4 Simulated DEPTH footage** — DONE (5de4283): RGB/DEPTH toggle on the Sensor View; depth
      pass renders a jet-colormap of view-space distance clamped to the D435i near/far (0.3–3 m).

## PARKED — finish camera alignment (the "camera thing, later")
- [ ] User moved the overhead D435i to the −X−Y corner (−0.357, −0.375, 0.85). Still to finalize:
      the roll/FOV to pixel-match the real `scene.mjpg`, AND move the primary arm base to where the
      real arm is (CAD render: clamped to the FRONT-RIGHT edge, facing INTO the table). Use the live
      Difference overlay to converge. (setPose roll support already landed.)

## BATCH (Jun 2026) — 9 items
- [answer] **#1** 3 design features to port → NavCube, dock search/filter, per-object eye toggles.
- [x] **#2** overlapping HUD elements — jog cluster moved up to clear toolbar + legend (87e0325).
- [answer] **#3** max reach (violet) = can-touch; precision fan (cyan) = can-grasp-from-above (subset);
      amber = camera footprint (not a reach).
- [clarify] **#4** "on top of snapping…" — fragment; assumed part of #7 (snap arms to edges). Confirm.
- [x] **#5** default to mm units (87e0325).
- [x] **#6** multiple workstations — DONE (42613ef): "Add workstation" = satellite worktop + paired
      arm on its edge + auto reach overlay; remove takes its arm too. User chose "full clones".
      Deferred follow-up: dedicated LIVE camera PIP feed per station (post mount already present).
- [x] **#7** snap arms to edges (on top of rod/post snapping) — DONE (60b56d8): "Snap to edge ·
      face in" snaps arm base to nearest rail + faces table centre via planner.localForwardAngle().
- [x] **#8** extra mount posts broke the main post's selection — fixed: raycast skips non-selectable
      occluders (54d0d8c).
- [x] **#9** right-click radial menu (Jog/Move/Aim), reusing existing mode fns + arm rotate gizmo (7c695bd).
- [x] **#1 trio** NavCube (snapToView) + dock search (KW filter) + per-object eye toggles (edd07b8). DONE.

## BATCH (Jun 2026) — NavCube / wrist cam / station feeds / HUD declutter
- [x] **NavCube** (ed108fa) — replaced the flat SVG with a real camera-synced CSS-3D view-cube
      (faces snap views, hover, Iso reset). Subagents confirmed neither OrcaSlicer NOR BambuStudio
      ships a view-cube widget (keyboard + Camera::select_view only), so it's original, using their
      Z-up orientation set.
- [x] **Wrist cam direction** (f7539e0) — it pointed inward at the base; aim() used local-Z (which
      lies horizontal) as "up". Fixed to local-X (the bracket axis) → now looks down over the
      fingertips at the table, matching the real HBVCAM mount.
- [x] **#3 per-station overhead feeds** (92f8a24) — StationCamera on each station's post → live
      overhead PIP per workstation, inside the new Feeds dock. (Completes #6's deferred camera half.)
- [x] **#4 HUD declutter** (Option 2: three edge docks) — DONE:
      · RIGHT: all camera PIPs consolidated into ONE bounded scrollable Feeds dock + Reasoning
        toggle on a slim rail (00175a3).
      · TOP: LayoutProfiles → ModeRail toggle (clears the title collision) (510babe).
      · BOTTOM: legend lifted above the jog cluster (510babe); appearance Tweaks folded from the
        floating gear into a toolbar button (a93ce5a).
      · LEFT: NavCube/legend/jog made dock-aware — tuck against the rail when the dock is closed
        (no dead gap, kills the duplicated magic-offset) (e54b725).
      Intentionally kept the NavCube always-visible (a view-cube should be) rather than hiding it in
      a View tab. Z-index now has a working hierarchy (30 content / 40 docks / 50 popovers); a formal
      named scale is the only untaken nicety.

## BIGGER ITEMS
- [x] **Save layout profiles** (f6dbc17) — save/restore the positional config (worktop + arm bases +
      overhead camera pose) as named profiles, persisted in localStorage. So mapped real-rig layouts
      can be stored + switched. profiles.ts + LayoutProfiles.tsx + rig.getPose/applyPose.
- [x] **Ghost wrist cam "inside/underneath"** — FIXED (2c9b4db). REAL cause: the wrist feeds reused the
      overhead D435i's hide-list, which hides the whole planningArmsGroup — so a ghost's OWN wrist cam
      rendered with itself hidden → never saw its gripper. (Tracking was fine; my overlap test was
      misleading because the ghost cam saw the still-visible PRIMARY arm.) Fix: hide ghosts per-camera,
      keeping each cam's own ghost visible. Verified: separate-mount ghost now shows its own gripper.
      NOTE: a downward wrist-cam tilt (~25°, matches the real angled HBVCAM) is still available as a
      nice-to-have if idle/upright framing needs improving — deferred, not needed for the bug.
- [ ] **Staged multi-arm physics** — N real SO-101 arms in one MuJoCo model + per-arm IK (physics
      first; pickup + Gemini multi-control later). [the "big lift"]
- [~] **Full reskin** to the lab-instrument design.
      DONE: foundation (b099917) — OKLCH palette remap + IBM Plex + crisp panels.
      DONE: phase 2a (4598789) — overlay legend, metric bar, tweaks panel (theme/accent, persisted).
      DONE: QA pass (c30fa05) — CodeRabbit + subagent QA → recoloured 3D overlays to the categorical
            scheme (camera=amber, reach=violet, precision=cyan) so the legend is truthful; theme
            persistence; a11y; z-index; dropped half-broken density.
      DONE: phase 3 (cda86c2) — left mode-rail (Edit/Compare/dock/perceive) + Compare A/B mode
            (A snapshot vs live B camera, footprint/coverage metrics + verdict); dock + left overlays
            shift to clear the rail. + QA fixes (4b6a221): dock overlap, honest compare copy, legend
            in both modes, rail keyboard a11y, real aspect in footprint.
      ✅ FULL RESKIN COMPLETE — foundation + 5 structural pieces + 2 CodeRabbit/subagent QA passes.

## DONE (this batch)
- [x] ROM reach → clean radial r(θ) fan (6c75c05).
- [x] Superimpose live Jetson feeds, correctly paired (overhead↔scene, wrist↔wrist) (2cf8b40);
      angled overhead + post hidden in PIP (f523386); setPose roll (c5d91cc).
- [x] Interactive joint posing "Jog joints" — vendored urdf-loader drag engine + MuJoCo adapter
      (da7f0c8). [blocked by #1 for real mouse — fix pending]

## Needs a decision
- [ ] **D435i framing vs reality** — real recorded "front" cam (= the D435i, only non-wrist cam)
      is a CROSS-TABLE front-elevated view (arm right, table left), NOT top-down like the sim.
      Decide: reposition the sim D435i to match the real recording, or keep the intended top-down
      (87 cm up the post, pointing down)? The sim D435i PIP is still 16:9 — match it to 4:3 too if
      we mirror the real capture.
- [ ] **Wrist framing fine-tune** — verify against real footage with the gripper at an actual grasp
      pose (real frame: fingers bottom, object ahead); dial back/up/reach; expose as sliders.

## Backlog (ordered, roughly)
- [x] **C — Rod snapping** (a099661) — snap camera/arm/objects to the nearest rod (post or rail) +
      'Along' slider to slide along it. Camera→post (vertical), arm→rails (horizontal). Post movable
      via X/Y. (Custom connector rods now handled by "Build connector rods" below.)
- [x] **D — Optimal multi-arm layout** (12fabc5) — greedy set-cover over (cell × yaw); 'Suggest
      optimal layout' places all arms for max top-down task coverage + shows X/Y reached.
- [x] **Build connector rods** (652615d) — '+ Add mount post' adds custom snappable uprights
      (editable X/Y, removable). Arbitrary point-to-point connector segments = future nicety.
- [x] **Wrist-cam framing tune** (62fd366) — back/up/reach + FOV exposed as live dock sliders;
      defaults dialed vs real footage (fingers at frame bottom, objects ahead). Tune further anytime.
- [~] **A3 — Ghost/preview** — CLOSED (won't-do): the live base move already shows motion in real
      time, so a non-committed ghost adds little. Reopen if you want preview-before-commit.
- [~] **A4 — Scale-to-dimension** — COVERED for the workcell (Length/Width are editable to exact mm).
      Per-object runtime scaling skipped (MuJoCo geom_size is structural; low value). Reopen if needed.

## Backlog status: CLEARED. Meaningful items (C rod-snap, connector rods, D layout, #3 calibration,
## #4 per-arm wrist) all done. A3/A4 closed with rationale; reopen either on request.

## Done (recent)
6-item inspector batch (Jun 2026):
- [x] **#1** non-primary arm glitch (3fb30a5) — onChange reset selectedArmId to primary every arm
      event; carry `armId` in SelectionInfo, use `s.armId ?? primary`. Non-primary fully editable.
- [x] **#3** inspector sliders (a7b673a) — draggable X/Y/Yaw (arm) + X/Y/Z (camera) alongside numbers.
- [x] **#4** arm 3D drag gizmo (a7b673a) — same in-viewport translate gizmo as the camera, on the
      arm base; getArmPose/onArmMove wire it. Rotate via the Yaw slider.
- [x] **#6** wrist defaults nudged (3fb30a5) — back/up/reach defaults for better gripper framing.
- [x] **#2** per-arm wrist cameras (5a9867b) — Map<armId, WristCamera>; one stacked 16:9 feed per
      arm (primary live, ghosts static mount-preview). Shared mount sliders apply to all.
- [answer] **#5** Gemini ER 1.6 multi-arm control → NO today. Only the primary is a physics arm
      (joints/IK/pickup); added arms are static planning ghosts. Real multi-arm control = each ghost
      becomes a full MuJoCo robot (joints + IK + pickup + task assignment) — the standing "big lift".

M6+: camera reset/frame, live base move (no "apply pose"), selection-driven UI (tree + inspector),
two-contour reach, orientation-aware real grasp, wrist camera, non-primary arm move + outline fix,
flicker (z-fight) fix, fern→fan reach smoothing. See todo.md + git log for detail.
