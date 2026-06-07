# SO-101 Digital Twin · Lab Instrument

A browser-based **digital twin & camera planner** for the [SO-101 / SO-ARM100](https://github.com/TheRobotStudio/SO-ARM100)
robot arm (a Franka Panda path is also retained). Lay out a robot workcell, pose arms with FK/IK,
measure distances, compare A/B camera setups, run a Google **Gemini** embodied-reasoning loop, and
save/sync layout profiles — all in the browser.

Built with **React 19 + TypeScript + Three.js (r181) + MuJoCo-WASM** (`mujoco-js`), bundled by
**Vite 6**, deployed on **Netlify**.

🔗 **Live:** https://so101-camera-planner.netlify.app/

---

## Features

- **Workcell layout** — live-editable worktop, rails, posts, props and satellite workstations
  (pure Three.js; editing never reloads physics).
- **Multi-arm** — place/auto-suggest multiple arms; non-primary arms are FK "ghosts".
- **Pose & reach** — click-drag joint jogging, numeric (DLS) IK for SO-101, analytical IK for Franka,
  reachability heatmaps + base-placement suggestions.
- **Cameras** — placeable D435i sensor camera with frustum/footprint/occlusion-coverage, gripper
  wrist cameras, fixed/overhead station cameras, picture-in-picture feeds, optional depth colormap,
  and real-vs-sim MJPEG overlay.
- **Measure** — CAD-style point/object distance with vertex/edge/surface snapping (m/mm).
- **Compare** — A/B comparison of two whole setups.
- **Embodied reasoning** — snapshot the scene → Gemini detects objects → project detections back into
  3D → reach/grasp.
- **Layout profiles** — save/load locally, ship built-ins, and sync with your team via Netlify Blobs.

---

## Quick start

**Prerequisites:** Node.js 20+.

```bash
npm install
npm run dev          # Vite dev server on http://localhost:3000
```

> The app fetches the robot model (MJCF + meshes) from the MuJoCo Menagerie on GitHub and the MuJoCo
> WASM runtime from a CDN at startup, so the first load needs network access.

### Optional: enable the Gemini reasoning demo locally

The Gemini features need an API key. For **local use only**, create a gitignored `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
EXPOSE_GEMINI_API_KEY_TO_BROWSER=true
```

⚠️ **Never commit `.env.local` or your key.** Vite inlines the key into the client bundle, so a
public deploy with `EXPOSE_GEMINI_API_KEY_TO_BROWSER=true` would leak it. Leave it unset/false for
any hosted build.

---

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server (port 3000) |
| `npm run build` | Production build → `dist/` |
| `npm run preview` | Preview the production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` / `npm run test:unit` | Vitest unit tests (pure logic) |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:smoke` | Playwright smoke/e2e (run `npx playwright install chromium` first) |

---

## Testing

- **Unit tests** (`test/*.test.ts`, Vitest) cover pure logic — formatters, linear algebra, and
  localStorage-backed profile merging. They are deliberately dependency-free (no WebGL/WASM) so they
  run in milliseconds.
- **Smoke/e2e** (`tests/*.spec.ts`, Playwright) boots the real app and checks it renders without
  console errors.

CI (`.github/workflows/ci.yml`) runs typecheck → unit tests → build → smoke on every push/PR, plus a
production-dependency security audit.

---

## Deploy

Hosted on Netlify (`netlify.toml`):

```bash
npx netlify deploy --prod --build
```

Notes:
- The Content-Security-Policy header (in `netlify.toml`) **must** allow `'unsafe-eval'` and
  `'wasm-unsafe-eval'` — the MuJoCo Emscripten runtime dynamically evaluates JS and compiles WASM.
  This only matters in production; `vite dev` doesn't serve the header.
- Team layout sync runs as a Netlify Function (`netlify/functions/layouts.mts`) backed by Netlify
  Blobs.

---

## Documentation

| Doc | For |
|---|---|
| [`AGENTS.md`](AGENTS.md) | **Start here** if you (or an AI agent) are about to change the code — repo map, reuse index, invariants. |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | How the system fits together: boot/data flow, modules, state sync, integrations, build/deploy. |
| [`docs/COMPONENTS.md`](docs/COMPONENTS.md) | Catalogue of reusable components, engine classes, types, and utilities — so you don't recreate them. |
| [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) | Dev setup, conventions, testing, CI, and the "reuse, don't recreate" rule. |

---

## License

Source files are marked `SPDX-License-Identifier: Apache-2.0`.
