# Goal — running backlog for the SO-101 digital-twin

The persistent "keep working on these" list. Per-item ritual: implement → tsc →
Playwright verify → commit (verify no `.env.local`) → CodeRabbit → subagent QA → fix.
Always `git -C /Users/laptop/Projects/lerobot/digital-twin-camera-planner` (CWD drifts).

## North star
A camera/arm/workcell planner whose sim decisions transfer 1:1 to the physical
SO-101 + D435i + Jetson rig — so layout, reach, camera placement, and grasps
chosen in sim hold up in the real world.

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
      via X/Y. STILL TODO: "build connector rods between mounts" (add custom rods) — deferred.
- [ ] **D — Optimal multi-arm layout** — suggest arm placements for **max task coverage** (most
      task points reachable top-down across all arms). Extend the single-arm base-placement
      (inverse reachability) to greedily place N arms; show + apply suggestions.
- [ ] **Build connector rods** (part of C) — add/draw custom rods between two mount points.
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
