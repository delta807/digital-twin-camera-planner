# Goal — running backlog for the SO-101 digital-twin

The persistent "keep working on these" list. Per-item ritual: implement → tsc →
Playwright verify → commit (verify no `.env.local`) → CodeRabbit → subagent QA → fix.
Always `git -C /Users/laptop/Projects/lerobot/digital-twin-camera-planner` (CWD drifts).

## North star
A camera/arm/workcell planner whose sim decisions transfer 1:1 to the physical
SO-101 + D435i + Jetson rig — so layout, reach, camera placement, and grasps
chosen in sim hold up in the real world.

## In progress
- [ ] **#3 Cross-reference real footage** — grab a live frame from the Jetson wrist cam
      (`/dev/video0` HBVCAM) + the RealSense D435i, compare framing/FOV to the sim PIPs,
      calibrate the wrist-cam mount + D435i FOV so the sim matches reality.
- [ ] **#4 Per-arm wrist cams** — each added arm gets its own gripper-mounted wrist camera + PIP.

## Backlog (ordered, roughly)
- [ ] **C — Rod snapping** — snap arm/camera/objects to the rods; slide the arm ALONG a rod (mimic
      moving along the alu extrusion); move rods (esp the upright post); align camera to a rod;
      build connector rods between mounts. (Asked for 3×; the post is already movable via X/Y.)
- [ ] **D — Optimal multi-arm layout** — suggest arm placements for **max task coverage** (most
      task points reachable top-down across all arms). Extend the single-arm base-placement
      (inverse reachability) to greedily place N arms; show + apply suggestions.
- [ ] **Wrist-cam framing tune** — expose back/up/reach mount offsets as sliders; dial in so the
      feed frames the grasp (less gripper body) once #3 gives the real reference.
- [ ] **A3 — Ghost/preview** (deprioritised; live base move already shows motion) — translucent
      ghost + dashed construction line + Δ readout for a non-committed move preview, if wanted.
- [ ] **A4 — Scale-to-dimension** (deferred) — type a target mm → scale = target/bbox; runtime
      MuJoCo geom scaling needs care (geom_size is structural).

## Done (recent)
M6+: camera reset/frame, live base move (no "apply pose"), selection-driven UI (tree + inspector),
two-contour reach, orientation-aware real grasp, wrist camera, non-primary arm move + outline fix,
flicker (z-fight) fix, fern→fan reach smoothing. See todo.md + git log for detail.
