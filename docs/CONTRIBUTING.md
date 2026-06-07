# Contributing

Thanks for working on the SO-101 Digital Twin. This guide keeps changes safe and consistent. If
you're an AI agent, also read [`../AGENTS.md`](../AGENTS.md) first.

---

## Setup

```bash
npm install
npm run dev        # http://localhost:3000
```

Node 20+. First load needs network (fetches the robot model + MuJoCo WASM at runtime).

---

## The golden rule: reuse, don't recreate

Before adding a component, util, or engine method, check [`COMPONENTS.md`](COMPONENTS.md). There are
already 17 React components and a full set of engine classes (IK, camera rigs, planner, measure,
selection, worktop builder). Re-implementing one of these is the most common way to add bugs and
drift. If an existing thing is close but not quite right, **extend it** rather than fork it.

---

## Conventions

- **TypeScript, strict-ish.** `tsconfig.json` uses `isolatedModules`, so use `import type { … }` for
  type-only imports.
- **File headers.** New source files start with the Apache-2.0 SPDX header (copy from any existing
  file).
- **Architecture pattern.** The 3D/physics core is **imperative** (`MujocoSim` + subsystems own
  state); React is the **declarative** layer that pushes config in via method calls and reads back via
  callbacks + a HUD rAF poll. Mirror React state into refs when an imperative callback needs the
  latest value. Don't try to make Three.js/MuJoCo objects React-managed.
- **Respect the invariants** in `AGENTS.md §4` (live worktop edits, live base relocation, two IK
  paths, ghost-arm FK oracle, CSP eval requirement, etc.).
- **Keep diffs minimal and scoped.** Don't reformat unrelated code. Don't commit unrelated
  working-tree changes — `git add` your specific files (this repo frequently has concurrent WIP).

---

## Testing

Two layers:

| Layer | Location | Tool | Run |
|---|---|---|---|
| **Unit** (pure logic) | `test/*.test.ts` | Vitest | `npm test` |
| **Smoke / e2e** | `tests/*.spec.ts` | Playwright | `npm run test:smoke` |

> Note the directory split: **`test/`** (singular) = Vitest unit; **`tests/`** (plural) = Playwright.
> They don't overlap.

### Writing unit tests

Unit tests must be **dependency-free** — no WebGL, no WASM, no DOM beyond the in-memory
`localStorage` shim in `test/setup.ts`. Good targets: formatters, math (`MatMath`), coverage/geometry
math, localStorage logic (`profiles`). If a function you want to test is buried in a component but is
actually pure, **extract it into a plain `.ts` module** and import it from both the component and the
test (don't add WebGL imports to the test process).

Rendering and physics behavior is the job of the Playwright smoke test, not unit tests.

### Before you open a PR / mark a task done

```bash
npm run typecheck
npm test
npm run build
npm run test:smoke      # first time: npx playwright install chromium
```

All four must pass. CI runs the same.

---

## CI

`.github/workflows/ci.yml` runs on push to `master`/`main` and on every PR:

1. `npm ci` (clean, lockfile-faithful install)
2. `npm run typecheck`
3. `npm test` (Vitest unit)
4. `npm run build`
5. Playwright smoke
6. `npm audit --omit=dev --audit-level=high` — fails only on **high/critical** vulns in
   **production** dependencies (the dev toolchain's known low-severity advisories don't block CI).

Keep CI green. If you add a dependency, run `npm audit --omit=dev` locally first.

---

## Security

- **Never commit `.env.local` or `GEMINI_API_KEY`.** The key is only inlined into the bundle when
  `EXPOSE_GEMINI_API_KEY_TO_BROWSER='true'` — keep that off for any hosted build.
- Don't weaken the `netlify.toml` CSP beyond what's required (`'unsafe-eval'`/`'wasm-unsafe-eval'`
  are required by MuJoCo; everything else is a deliberate allow-list).

---

## Commits

- Small, focused commits with clear messages.
- Don't bundle unrelated changes.
- Working notes live in `tasks/` (`todo.md`, `lessons.md`) — update `lessons.md` when a mistake
  teaches a rule worth keeping.
