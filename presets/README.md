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

Tag `presets-v0.1.2`. Syntax checked against the docs (pnpm: "Install from a
subdirectory of a Git repository", pnpm.io/package-sources; uv: "Dependency sources, Git, subdirectory",
docs.astral.sh/uv/concepts/projects/dependencies) and by installing each from this repo's branch.

```jsonc
// package.json
"devDependencies": {
  "@dfox288/test-preset-vitest": "github:dfox288/current-rules#presets-v0.1.2&path:/presets/vitest",
  "@dfox288/test-gates": "github:dfox288/current-rules#presets-v0.1.2&path:/presets/gates"
}
```

```toml
# pyproject.toml
[dependency-groups]
test = ["dfox288-test-preset", "<the repo's DB driver, if it has a database>"]

[tool.uv.sources]
dfox288-test-preset = { git = "https://github.com/dfox288/current-rules", subdirectory = "presets/pytest", tag = "presets-v0.1.2" }
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

The gate summary also reports the protected count, one line per tier that ran, right after the gate table:

```
  small: 437 tests, 41 protected
  medium: 12 tests, 0 protected
```

The format is `<tier>: <n> tests, <m> protected` (grep `^  <tier>: [0-9]+ tests, [0-9]+ protected$`). `n` is the count the
floor guards; `m` is how many of those tests carry `protected`: pytest `@pytest.mark.protected` on the test, its class
or its module (`pytestmark`), Vitest the `protected` tag on the test or on a `describe` around it. The count comes
from the run of the tier itself (the preset writes it into the run summary next to the tier's test count), so it
needs no second command and no database beyond what the tier's run already has; it counts tests that ran, so a
quarantined `protected` test is not in it. A tier with none says `0`. A preset older than 0.1.3 writes no count and
the line says `protected not reported`, never `0`. The count is reported, not gated: floors are unchanged.

## What the guards do not catch

Small's guards stop the usual ways to reach the network, a file or the database from test code. A reviewer reading a
small test still checks for these (ruling 25 leaves process starts and sleeps to review):

- **Both stacks:** child processes (`execSync`, `subprocess`, `multiprocessing`: their network and writes are not
  seen); sleeps; booting a server or container; a write through a file descriptor opened before the test; a symlink
  that points out of the temp dir; a test that changes its own limit at runtime (`vi.setConfig`); DNS lookups made by
  the resolver library rather than a socket (`dns.resolve*`).
- **Vitest only:** code in a `worker_threads` Worker (the setup file does not run there, so network and writes in a
  worker are not guarded); `listen` is not guarded. UDP (`dgram` `send`/`connect`) is guarded.
- **pytest only:** `from socket import socket` executed before the plugin loads keeps the real class (a pytest-socket
  limit); writes made by C libraries other than `sqlite3`; a `SocketBlockedError` that the code under test swallows
  only becomes a warning. Threads, executors and `asyncio.to_thread` are guarded (the write guard is process-wide and
  pytest-socket patches `socket` globally).
- A test may lower its limit; raising it (`{ timeout }` in Vitest, `@pytest.mark.timeout`) fails the run.

## Pinned versions

The Vitest preset's reporter uses two members that Vitest does not type (`onAfterSetServer`, `reporters`), so its
peer `vitest` is an exact version (a repin moves it, the break-its prove the hooks still work). The pytest plugin
uses private members of pytest, pytest-timeout and `tempfile`; those are pinned the same way, and Python is 3.14.

## Proof

`.github/workflows/presets.yml` runs `check:dist`, the gate script's unit tests and the four break-it runs on every pull
request and push to main. `fixtures/break-it.ts` plants each violation and checks the run is red for the stated reason:

```
TEST_DATABASE_URL=postgres://... node presets/fixtures/break-it.ts <vitest|pytest|gates|gates-pytest> [filter]
```

`refresh-nuxt.sh` and `refresh-pytest.sh` reinstall a changed preset into its fixture.
