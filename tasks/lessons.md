
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
