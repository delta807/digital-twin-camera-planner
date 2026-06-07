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

- [x] Check local repo/generated artifacts for secrets or dangling deploy files.
  - Verify: grep/status checks show no tracked or generated API-key literals beyond ignored local env files.
- [x] Check Netlify public state.
  - Verify: live app and final deploy return 200, stale asset and deleted deploys return 404.
- [x] Check dependency/header posture.
  - Verify: `npm audit` triaged and live response headers inspected.
- [x] Reconcile subagent findings.
  - Verify: every concrete issue is fixed or explicitly reported.

### Review

- Subagents confirmed generated artifacts and Netlify state were clean of the exposed key; `.env.local` remains ignored but must be rotated because of the earlier brief deploy exposure.
- Hardened accidental-build behavior: `vite.config.ts` now exposes `GEMINI_API_KEY` to the browser only when `EXPOSE_GEMINI_API_KEY_TO_BROWSER=true`.
- Public Detect is disabled unless a browser key is deliberately exposed; Gemini JSON output is bounded to 25 validated detections with 0..1000 coordinates.
- Extended `.gitignore` for `.env`, `.env.*`, `.env.example` exception, and `.netlify`.
- Ran `npm audit fix`; `npm audit` and `npm audit --omit=dev` now report 0 vulnerabilities.
- Netlify deploy inventory contains only final deploy `6a21c1f93cf8b1b844dbaa12`; all earlier deploy permalinks checked are deleted/404.
- Live headers now include CSP, Permissions-Policy, Referrer-Policy, X-Content-Type-Options, X-Frame-Options, and HSTS.
- Playwright showed the strict CSP blocks the current MuJoCo/Emscripten runtime because it requires `unsafe-eval`; deploy of that CSP relaxation needs explicit approval, or the runtime should be replaced/packaged differently.

## Netlify Alignment Check — latest master (Jun 2026)

### Assumptions

- Treat GitHub `origin/master` as the "latest main" branch unless the user says otherwise.
- Do not overwrite local modified files.
- Prefer Netlify's Git-connected deploy if the site is configured for auto deploys; use manual `--no-build` deploy only if Git deploy is not aligned or not active.

### Plan

- [x] Verify local `master` vs `origin/master`.
  - Verify: `git fetch origin` and compare commit tips.
- [x] Verify Netlify site linkage/deploy source.
  - Verify: Netlify status/deploy info shows whether production is Git-backed and which commit is live.
- [x] Update production only if needed.
  - Verify: live URL returns the expected deployed asset and headers after the update.

### Review

- Fetched `origin`; GitHub default branch is `origin/master` at `9a35cfa` (`Merge pull request #1 from delta807/reskin-and-fixes`).
- Local `master` is ahead of `origin/master` by 7 commits and has modified app files, so deploying from the current worktree would include local-only work.
- Netlify site `so101-camera-planner` is linked locally by site ID, but API metadata shows no Git auto-deploy settings: `build_settings` is empty, `deploy_hook` is null, and the published deploy has `commit_ref: null`, `branch: null`, `deploy_source: "cli"`.
- Deployed a clean temporary worktree at `origin/master` with `npm ci`, `npm run build`, `npm audit --omit=dev`, then `netlify deploy --prod --no-build --dir=dist --site=457c9dd3-1efb-46b2-9f88-3e559b078bea`.
- Production deploy: `6a227e79b47315fc6769706f`; live URL: https://so101-camera-planner.netlify.app; live HTML references `/assets/index-PYNdHe5S.js`; the asset returns HTTP 200 JavaScript with the expected headers.

## HUD refinement pass 2 (review)
- [x] 1. Objects tree section collapsed by default (`Section defaultOpen`).
- [x] 2. Primary worktop is now right-clickable (tagged `selectable='station'` id `primary`) → radial Move / Aim·yaw; inspector exposes Sides/Length/Width/Yaw/X·Y. New `originX/originY/yaw` in `WorkcellConfig` baked into the rim (origin stays 0,0 → reach/coords unaffected).
- [x] 3. Removed redundant X/Y/Yaw sliders from the dock Arms section (right-click + Selection card own it).
- [x] 4. Measure moved out of the dock into a Controls toolbar toggle (Ruler); results list renders under the toolbar when active.
- [x] 5. Controls section now sits above Embodied Reasoning.
- [x] 6. Jog joints is a Controls toolbar toggle (Hand icon); hint + Save-rest-pose surface under the toolbar when jogging.
- [x] 7. Sidebar header shows the MetricBar contents (floating pill kept only as a fallback when the panel is closed).
- [x] 8. Selection card mirrors the dock controls for the wrist camera (X/Y/Z offset, Tilt, FOV, Save, Factory reset). Wrist cameras added to the Objects tree so the tiny glyph is easy to select.
- Verified in-browser (vite-dev :3000): section order, header readout, collapsed tree, primary right-click radial, live yaw/sides edit, wrist-cam controls — all with 0 console errors; `tsc --noEmit` clean.

## HUD refinement pass 3 (review)
- [x] 1. Sidebar header dropped Reach + MuJoCo/60Hz; now shows title + Arms + an m/mm unit toggle.
- [x] 2. Per-item radials reuse existing handlers (DRY): arm = Jog/Move/Aim·yaw/Duplicate(+Delete unless primary); station = Move/Aim·yaw/Duplicate(+Delete unless primary); extra camera = Move/Aim/Duplicate/Delete; box = Move/Aim/Hide; wristcam + primary cam = Move/Aim.
- [x] 3. Right-click empty space → "create here" radial (Workcell / D435i cam / SO-101 / Mount post) placed at the clicked ground point (SelectionController.groundPointAt).
- [x] 4. Dock header gained a prominent SAVE button (→ layout profiles).
- [x] 5. Primary arm is bolted to the table — move/rotate the worktop carries the arm.
- [x] 6. Migrated controls into per-item Selection cards + slimmed the dock:
      • Camera card: Show camera, wrist feed, FOV frustum / PIP / footprint / highlight / coverage, stream profile, H-FOV, min/max range, reset optics (whole dock Camera section removed).
      • Arm card: reach-view toggles + Remove this arm.
      • Table card (primary): rail height/width, post height/X/Y (+ existing sides/length/width/yaw/X/Y).
      • Dock now: Objects, Scene, Workcell(add posts/stations/overhead cams), Arms(add + compute settings), Save. Units in header.
- Box move/aim gizmo added (setObjectAim + setTaskBodyYaw). Verified in-browser; tsc clean; 0 console errors.

## HUD refinement pass 4 (review)
- [x] 1. Real-camera overlay was blank because the source is a hardcoded Jetson Tailscale IP
      (unreachable off that tailnet; http blocked as mixed-content on https hosts). Stream URL is
      now an editable, persisted field in the compare controls, with an on-error placeholder.
- [x] 3. Obvious panel open/close: dock gained a PanelLeftClose in its header; sidebar keeps its X.
      When a panel is closed a drawer-open button shows at that top corner (left = PanelLeft, right
      = PanelRight).
- [x] 4. Double-clicking an object opens the same radial as right-click.
- [x] 5. "Save wrist cam position" now also copies a paste-ready `WRIST_FACTORY = {...}` code line to
      the clipboard, so a tuning can be baked into App.tsx and shipped to everyone (the shipped
      default already lives in that constant).
- [x] 6. Bundled presets: new presets.ts (BUILTIN_PROFILES) loads as read-only built-in layouts;
      Layout profiles gained an "Export JSON (for repo)" button to copy all profiles for pasting
      into presets.ts and committing. Built-ins show a badge + no delete.
- [ ] 2. (suggestion only) Left panel is now mostly "add" controls — see response for 3 directions.

## HUD refinement pass 5 (review)
- [x] 1. Panel toggle consolidated: removed the Controls-toolbar panel button; the sidebar header
      close is now PanelRightClose (right-pointing), matching the dock's PanelLeftClose (left).
- [x] 2. Wrist cameras on by default (wristView initial = true).
- [x] 3. Left dock redesigned into Insert (click-to-add palette) · Outliner (objects grouped by
      Arms/Workcells/Cameras/Wrist cams/Posts/Tasks, select + hide) · Scene & templates (axes,
      coord readout, load saved/built-in layouts, reachability compute). Old Workcell/Arms/Scene
      sections + the dock search removed.
- [ ] 4. (explained, not built) Boxes are static MuJoCo bodies compiled into the model at load —
      add/remove needs a model recompile + reload. Options written up for the user.
- [ ] 5. (researched) Online sync for shared arrangements — git-as-DB (Decap/TinaCMS style) vs
      Netlify Blobs/DB vs Supabase. Written up for the user.
