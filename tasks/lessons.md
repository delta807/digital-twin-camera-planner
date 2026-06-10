
## CWD drift between Bash calls (2026-06-04)
The shell re-initializes from the user's profile between some Bash calls, so the
working directory can silently reset from the project dir to the PARENT
`/Users/laptop/Projects/lerobot` — which is a DIFFERENT git repo
(so101-jetson-rig-dashboard). A bare `git push` there failed/targeted the wrong
repo; a bare `tsc` failed with "no such file". No work was lost (commits were
made while CWD happened to be correct), but this could have been catastrophic.
RULE: prefix EVERY Bash command that touches the project (git, tsc, npm, file
ops) with `cd /Users/laptop/Projects/lerobot/digital-twin-camera-planner && ...`.
Never run a bare git/tsc command assuming CWD persists.

## Backticks in `git commit -m "..."` get shell-executed (2026-06-04)
A commit message passed via `-m "...`compare` overlay..."` inside DOUBLE quotes had
the backtick-wrapped words command-substituted by the shell (`compare: command not
found`) and SILENTLY DELETED from the message. The commit still succeeded, mangled.
RULE: for commit messages containing backticks/`$`/`!`, write the message to a temp
file and use `git commit -F /tmp/msg.txt` (or `--amend -F`). Never inline backticks
in a double-quoted `-m`.

## Playwright MCP writes screenshots to the PARENT repo dir (2026-06-04)
`browser_take_screenshot({filename:'x.jpeg'})` saved to `/Users/laptop/Projects/lerobot/x.jpeg`
(the parent repo, CWD-drift again), NOT the project dir. Find via
`find /Users/laptop/Projects/lerobot -maxdepth 1 -name x.jpeg`, Read it, then rm it so it
never lands in the wrong repo's git. (Verifying images this way works well.)

## A "diagnostic test" can give false confidence — check the SETUP confound (2026-06-05)
Chasing "the additional arms' wrist cams are bad," I ran an overlap test (two arms at the SAME
pose) and saw identical feeds → concluded the tracking was correct, twice, and even shipped a
wrong "robust" rewrite + proposed an unrelated tilt fix. The overlap was the confound: with arms
stacked, the GHOST's wrist cam saw the still-visible PRIMARY arm sitting where its own (hidden)
gripper would be — so it looked fine for the wrong reason. The real bug: the wrist feeds reused the
overhead PIP's hide-list, which hides ALL ghost arms, so a ghost's own wrist cam rendered itself
hidden. RULE: when a test "passes," ask what ELSE could produce that result. Test at the REAL
configuration (here: arms at DIFFERENT positions), not a degenerate one. And when the USER insists a
bug is real after you've "ruled it out," re-investigate from scratch — they were right.

## Wrist camera mount — regressed 5× (Jun 2026). SETTLED.
Symptom (kept coming back): the wrist cam pointed inward / sat among the claws / mounted on the
side — different each time a pose changed.
ROOT CAUSE: I kept DERIVING the mount from the TCP **site**. The TCP site is authored at
`pos="0 -0.1 0"` inside the `Fixed_Jaw` body (RobotLoader.ts) — i.e. 0.10 m DOWN at the FINGERTIPS,
not at the gripper body. Every "fix" stacked fudge offsets (back/up/reach, up=0.16) on top of that
wrong origin AND guessed which world-projected local axis was "up"/"forward". Those guesses only hold
in one pose; Wrist_Roll/Pitch rotate the axes, so any motion re-broke it.
RULES:
- The wrist cam is a RIGID mount. Define it as a CONSTANT local offset (posX/posY/posZ) + a tilt in
  the gripper's own frame, then carry it by the gripper orientation. NEVER re-derive from
  `site_xpos` + two `site_xmat` columns with sign/axis guesses.
- The `Wrist_Roll` joint lives INSIDE `Fixed_Jaw` (so_arm100.xml) — `Fixed_Jaw` IS the wrist-roll
  gripper body and is stable (only `Moving_Jaw` articulates). The TCP site shares its orientation but
  is offset to the fingertips; the gripper *body* origin is ~+0.10 along localY.
- The literal gripper CENTRE (posY≈0.05) is INSIDE the servo/jaws → a dark feed. Default posY≈0.14
  (clear of the mechanism) and expose pos+tilt so it's tunable, not hardcoded-perfect.
- If a mount "works," verify it in MULTIPLE poses (home + a Wrist_Roll-jogged pose), not just home.

## Analysis figures — frame discipline (layout optimizer "looks weird", 2026-06; CORRECTED)
- CORRECTION (a QA audit caught me): the reach-grid CELLS (`armCells`/`reachCells`/`cellsMax`) are stored
  in the WORLD-AXIS base-relative frame — `sweepArm` keys them by the raw world offset `(tx−baseX,ty−baseY)`
  with the arm's yaw ALREADY baked into the world TCP `tx,ty` (`setSweepBase` rotates the base body before
  the sweep). The `cos(-yaw)/sin(-yaw)` un-rotation feeds ONLY the radial OUTLINE (`accumRadial`), NOT the
  cell keys. So consumers project with the RAW world offset and must NOT rotate: `getReachWorld`,
  `workspaceMetrics`, `getHandoff`, `computeBasePlacement`, `getManipulability/Effort/CycleTime` are all
  correct as-is. `suggestArmLayout` rotates by `primaryYaw − yaw` only because it tests DIFFERENT candidate
  yaws (net 0 at the swept yaw).
- My first "fix" to `getLayoutScores` added a −yaw rotation on the FALSE premise that cells were local-frame.
  That REGRESSED #11 for any yaw≠0 arm; it only looked fine because the primary's yaw≈0 (rotation→identity).
  Correct fix: index the RAW world offset (reverted). The UX additions (current-mount marker, star offset
  label, current→best delta, axis labels) were the real answer to the user's "where exactly?" — keep those.
- Lessons: (1) VERIFY the stored frame by reading the line that builds the KEY, not a nearby rotation that
  may feed a different structure. (2) A change that's a no-op at yaw=0 will pass a yaw=0 spot-check — test
  the actual failing condition (a yawed arm), not just the convenient one. (3) When two paths consume one
  grid and disagree, the MAJORITY that's visually validated (renderers/overlays) is usually the source of
  truth — reconcile toward it, don't "fix" it to match the outlier.
- UX: an optimizer figure must be ACTIONABLE — show the CURRENT state, the recommended state, the delta,
  and concrete coordinates (cm from a marked reference), not just an abstract optimum blob.

## Catalog BASIC→LIVE upgrades — reuse passes, avoid the embind output-buffer trap (2026-06)
- mujoco-wasm exposes `mj_jacSite`/`mj_rne` but they need caller-allocated output buffers through embind
  `any` params (fragile). For manipulability #1 we instead built the translational Jacobian by central
  finite-difference of the TCP site vs each joint — uses only the positions-only `mj_kinematics` the reach
  sweep already runs. Prefer reusing a proven pass over new marshalling.
- `qfrc_bias` IS a readable data field: after a static `mj_forward` at qvel=0 it's the pure gravity torque
  (effort #2). Needs the joint's dofAdr (`jnt_dofadr`), which differs from qposAdr — plumb it on SweptJoint.
- GSD #5 is pure optics (range × ifov / cos-incidence) — no depth-render extraction needed; reuse the
  coverage frustum+occlusion test and return NaN for unseen cells.
- Live verification gotcha: scope switches trigger a reach recompute that CLEARS `armCells` mid-flight, so
  reach-derived figures (reach/manip/effort/conflict/handoff) read null transiently. Wait for the
  "Updating reach" overlay to clear AND ~2s more before asserting a figure is missing.

## autoresearch — region geometry must match the rendered twin (Jun 2026, /goal #A1)
- Two distinct lessons from the corner-feasibility item:
  1. "Infeasible" can be PHYSICS, not a bug. Corner blobs at 0.6·size were ~38% graspable because they sit
     in the arm's NEAR-field (the only arm close enough is too close for a top-down grasp; farther arms are
     out of reach). The fix was to model a realistic corner *zone* (inset 0.45·size) + finer placements —
     not to force the constraint. Investigate the data (graspableFrac) before assuming a code fault.
  2. Any code that generates positions for the twin MUST use the twin's coordinate convention. regionsFor/
     edgeMount used vertex angle 2π·k/n (vertex at 0°) but BaseBuilder builds the N-gon at −π/2+2π·i/n
     (vertex at −90°) → a 90° rotation that's INVISIBLE on a square (90° is a square symmetry) but wrong for
     n=3/5/6. Verifying only on the convenient symmetric case (n=4) hid it. Lesson: when generating geometry
     for a renderer, grep the renderer's actual angle/origin convention and reuse it (shared constant), and
     verify on an ASYMMETRIC case (a non-square polygon), not just the easy one.

## autoresearch — a "magic number" override was a preset, not a stale read (Jun 2026, /goal #A3)
QA found ~6.7% of trials logged camera z ≈ 0.9796930009124906 regardless of the requested z. I FIRST
assumed a stale world-matrix read and added `gizmo.updateMatrixWorld(true)` to `setPose` — it fixed
nothing (z=0.45 still read 0.98), because the hypothesis was wrong. Grepping the literal value
(`grep 0.9796`) pointed straight at `presets.ts` — it's the built-in IRL-layout preset camera height.
ROOT CAUSE: an async startup profile-load re-applies that preset AFTER the autoresearch readiness gate
(`scoreCurrentScene()!=null`) passes, clobbering the FIRST `applyConfig`'s camera on each fresh page.
The count was the tell: 14/210 = exactly workers(2)×regions(7) → one clobbered candidate per worker.
FIX: a discarded warm-up `applyConfig` in `newReadyPage` consumes the race (verified: 2nd+ applies
stick). RULES: (1) before "fixing" a suspicious constant, GREP THE LITERAL VALUE — it often names its
own source (a preset/default), which is faster and truer than guessing a mechanism. (2) A no-op "fix"
that doesn't change the symptom means the hypothesis is wrong — re-test the symptom immediately, don't
assume. (3) An error count that factors cleanly into run parameters (workers×regions) is a structural
clue (per-page init race), not random noise. (4) A readiness gate that checks signal A doesn't
guarantee async init B has settled; gate on the thing you actually depend on, or consume the race.

## Reach sweep re-runs on every scene reload — coalesce for multi-arm layouts (2026-06-10)
Loading a 9–10-arm / multi-station layout (the "bestagon" profiles) made the
"Computing reach…" spinner churn repeatedly. Two compounding causes: (1) the
expensive multi-arm FK reach sweep ran on EVERY `onSceneReload` (App
`applyPlannerState`) AND again inside `MujocoSim.setupPlanner` — and a multi-
station load fires several reloads back-to-back, so N reloads → ~2N sweeps. Fix:
defer the sweep through one debounced scheduler that also waits out
`MujocoSim.reloading`, so a burst of reloads collapses to ONE sweep on the
settled scene; apply only the cheap toggles/obstacles synchronously.
Lessons: (1) Per-arm/per-reload O(arms × FK) work is fine at 1 arm and explodes
at 9 — always ask "what happens at 10×?" before shipping a layout that scales the
unit of work. (2) When a heavy job is triggered by a reactive event that can fire
in bursts (scene reloads, slider drags), debounce + gate on a settled signal
rather than running per event. (3) Verifying in a BACKGROUNDED preview tab is a
trap: `runHeavy` clears its busy overlay inside `requestAnimationFrame`, which the
browser THROTTLES when the tab isn't visible — the spinner sticks even though no
work runs. Count jobs with a `setTimeout`-based counter (fires regardless of
visibility), not the overlay, to judge whether a loop is real.
