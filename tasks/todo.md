# TODO — 4-item batch (Jun 2026)

(Prior milestones archived in todo.archive.md.)

User decisions: order = ROM→superimpose→design→multi-arm · multi-arm = staged (physics+IK first)
· reference img = capture from live Jetson · design = FULL reskin.

## Phase 1 — ROM fan fix (radial r(θ) reach) ✅ DONE (6c75c05)
Root cause (subagent): grid-march (9⁴ sweep) + weak R=2 morph-close + buggy chainLoops/Chaikin →
fragmented, self-crossing, non-fan. Fix = change representation to a radial profile.
- [ ] Sweep base-rotation joint finely (BASE_STEPS) × other joints (resolution); per angular bin
      record min/max reach radius for MAX set + PRECISION (top-down) set.
- [ ] Build the fan loop directly from r(θ): outer arc (rMax) forward + inner arc (rMin) back,
      opening at the largest angular gap (sector) or two rings if it wraps fully. Guaranteed clean.
- [ ] Keep reachCells/reachCellsMax (cells) for base-placement + layout set-cover (unchanged).
- [ ] Remove computeLocalSilhouette morphology + chainLoops (dead). Keep chaikin (light smooth).
- [ ] tsc → Playwright verify clean fan (1 + 2 arms) → commit.

## Phase 2 — Camera superimpose vs live Jetson ✅ DONE (ccb0805)
Jetson overhead feed found: http://100.68.215.10:8080/stream.mjpg (FPV MJPEG, 848×480).
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

## Netlify Setup — SO-101 camera planner (Jun 2026)

### Assumptions

- Deploy the app from this repository root as a Vite static site.
- Use `npm run build` and publish the generated `dist` directory.
- Keep `GEMINI_API_KEY` out of source; configure it in Netlify if Gemini Detect/Pickup should work online.
- Preferred concise site slug: `so101-camera-planner`.

### Plan

- [x] Add minimal Netlify build config.
  - Verify: `netlify.toml` points build to `npm run build` and publish to `dist`.
- [x] Build locally before deployment.
  - Verify: `npm run build` completes and regenerates `dist`.
- [x] Check Netlify authentication/linking and deploy.
  - Verify: Netlify returns a live deploy URL.

### Review

- Created and linked Netlify project `so101-camera-planner`.
- Production URL: https://so101-camera-planner.netlify.app
- Deploy URL: https://6a21bf685f183d68ddabaddb--so101-camera-planner.netlify.app
- Verified: clean `npm run build -- --mode netlify`, local HTML points to `/assets/index-UVdlt9zT.js`, no local API-key literal in `dist`, production deploy used `--no-build`, live HTML points to the safe bundle, safe bundle returns HTTP 200 JavaScript, and the stale bundle path returns HTTP 404.
- Deleted the earlier bad deploy records that rebuilt with `.env.local`; their permalinks now return HTTP 404. Rotate the local Gemini API key anyway because it was exposed during the brief initial deploy window.
- Gemini Detect/Pickup is intentionally deployed without the local `.env.local` key embedded; enable it later via a deliberate browser-visible key or a serverless proxy.

## Security Follow-up — Netlify deploy cleanup (Jun 2026)

### Assumptions

- Scope is this app and the Netlify deployment, not the whole parent `lerobot` workspace.
- Verify public reachability, local secret/artifact residue, dependency audit, and deploy headers.
- Use subagents for independent checks, then reconcile findings before closing.

### Plan

- [ ] Check local repo/generated artifacts for secrets or dangling deploy files.
  - Verify: grep/status checks show no tracked or generated API-key literals beyond ignored local env files.
- [ ] Check Netlify public state.
  - Verify: live app and final deploy return 200, stale asset and deleted deploys return 404.
- [ ] Check dependency/header posture.
  - Verify: `npm audit` triaged and live response headers inspected.
- [ ] Reconcile subagent findings.
  - Verify: every concrete issue is fixed or explicitly reported.

### Review

- Pending.
