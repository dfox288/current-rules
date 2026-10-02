# Presets

What `testing.md` and the bindings (`bindings/nuxt-ts.md`, `bindings/python.md`) say a repo's test setup is made of,
as installable code. A repo installs a preset as a git dependency pinned to a tag and adds only its project list and
its justified differences.

| Directory | What | Stack |
|---|---|---|
| `vitest/` | Vitest config builder, small's guards, count guard, DB helper, `e2e` build-once and browser helper | Nuxt / TypeScript |
| `pytest/` | pytest plugin (markers, limits, guards, count guard) and DB helper | Python 3.14 |
| `gates/` | the shared gate script, one set of gate names for both stacks | both |
| `fixtures/` | a minimal Nuxt app and a minimal Python package that consume the presets, and `break-it.ts` | tests of the presets |

## Install

Tag `presets-v0.1.0` (proposed; a repin bumps it). Syntax checked against the docs (pnpm: "Install from a
subdirectory of a Git repository", pnpm.io/package-sources; uv: "Dependency sources, Git, subdirectory",
docs.astral.sh/uv/concepts/projects/dependencies) and by installing each from this repo's branch.

```jsonc
// package.json
"devDependencies": {
  "@dfox288/test-preset-vitest": "github:dfox288/current-rules#presets-v0.1.0&path:/presets/vitest",
  "@dfox288/test-gates": "github:dfox288/current-rules#presets-v0.1.0&path:/presets/gates"
}
```

```toml
# pyproject.toml
[dependency-groups]
test = ["dfox288-test-preset", "<the repo's DB driver, if it has a database>"]

[tool.uv.sources]
dfox288-test-preset = { git = "https://github.com/dfox288/current-rules", subdirectory = "presets/pytest", tag = "presets-v0.1.0" }
```

pnpm fetches a GitHub dependency as a tarball (no `git` needed); uv runs `git`. The built JavaScript (`dist/`) is
committed, because pnpm skips install scripts (`prepare`) here: after changing `vitest/src` or `gates/src` run
`pnpm build` in that directory, and `pnpm check:dist` fails when `dist/` is stale.

## Vitest

```ts
// vitest.config.ts
import { defineTestConfig } from '@dfox288/test-preset-vitest'

export default defineTestConfig({
  unit: { include: ['test/unit/**/*.test.ts'] },
  nuxt: { include: ['test/nuxt/**/*.test.ts'] },
  e2e: {
    include: ['test/e2e/**/*.e2e.test.ts'],
    globalSetup: ['test/e2e/global-setup.ts'], // export default buildOnce(() => runBuild('pnpm', ['build']))
    hookTimeout: 120_000,                      // measured by the pilot
  },
})
```

A repo may add `plugins`, `resolve`, `define`, and `test` options with a `justification`; limits, retries, tags and
`TZ` cannot be set (the config throws). Helpers: `/db` (`openTestSchema`), `/e2e` (`buildOnce`, `runBuild`,
`startBuiltApp`, `freePort`), `/e2e/browser` (`launch`, `openPage`, `hitsInside`, `settle`; needs `playwright`).
Tests carry tags with `it(name, { tags: ['medium'] }, fn)`.

## pytest

Installing the package loads the plugin (entry point `pytest11`). Markers `medium`, `large`, `protected`,
`quarantine`; `--strict-markers` and `--import-mode=importlib` are forced. `dfox288_test_preset.db.open_test_schema`
takes the repo's `connect(url)` (a DB-API connection) and gives a schema that is dropped on exit.

## Gates

`gates.config.json` in the repo: `{ "stack": "vitest" | "pytest", "gates": { "lint": ["pnpm", "lint"], ... } }`; then
`test-gates` (or `test-gates --only=small,medium`). Gate names: `lint`, `format`, `typecheck`, `small`, `medium`,
`large`, `build`. `lint` and `format` red stop the run. A tier below its floor in `test-floors.json`, one that ran
zero tests and one whose run wrote no summary (the preset did not run) are red; `--raise-floors` raises the floors
after a green run and never lowers them. The last line is `GATE GREEN (...)` or `GATE RED: <gate (reason)>, ...`.

## Proof

`fixtures/break-it.ts` plants each violation and checks the run is red for the stated reason:

```
TEST_DATABASE_URL=postgres://... node presets/fixtures/break-it.ts <vitest|pytest|gates|gates-pytest> [filter]
```

`refresh-nuxt.sh` and `refresh-pytest.sh` reinstall a changed preset into its fixture.
