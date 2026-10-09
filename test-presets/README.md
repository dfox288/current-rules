# Test-presets

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

Tag `test-presets-v0.5.1`. The two npm packages come from the private registry (see "Release and registry install"
below); the pytest package is a git dependency. Syntax checked against the docs (pnpm: "Install from a
subdirectory of a Git repository", pnpm.io/package-sources; uv: "Dependency sources, Git, subdirectory",
docs.astral.sh/uv/concepts/projects/dependencies) and by installing each from this repo's branch.

```jsonc
// package.json
"devDependencies": {
  "@dfox288/test-preset-vitest": "0.5.1",
  "@dfox288/test-gates": "0.5.1"
}
```

```toml
# pyproject.toml
[dependency-groups]
test = ["dfox288-test-preset", "<the repo's DB driver, if it has a database>"]

[tool.uv.sources]
dfox288-test-preset = { git = "https://github.com/dfox288/current-rules", subdirectory = "test-presets/pytest", tag = "test-presets-v0.5.1" }
```

pnpm fetches a GitHub dependency as a tarball (no `git` needed); uv runs `git`. The built JavaScript (`dist/`) is
committed, because pnpm skips install scripts (`prepare`) here: after changing `vitest/src` or `gates/src` run
`pnpm build` in that directory, and `pnpm check:dist` fails when `dist/` is stale.

## Release and registry install

The two npm packages (`@dfox288/test-preset-vitest`, `@dfox288/test-gates`) are also published to the private npm
registry `https://npm.registry.tastatur-und-maus.net/`, so a repin is a version bump and needs no git access. The
pytest package stays a git dependency.

Cutting a release:

1. Bump `version` in `vitest/package.json` and `gates/package.json` to the same number, run `pnpm build` where `src`
   changed, move the CHANGELOG's Unreleased entries under the new version, merge to `main`.
2. Tag the merge commit `test-presets-vX.Y.Z` and push the tag.
3. `.github/workflows/test-presets-release.yml` builds and tests both packages, then publishes them. It fails before
   publishing when the tag differs from either `package.json` version, when `dist/` is stale, or when the version is
   already on the registry (nothing is overwritten). Credentials come from Infisical by OIDC. A manual dispatch is a
   dry run (packs both, prints the file lists, publishes nothing).

Pinning the registry version in a repo (the scope is `@dfox288`; the repo's `.npmrc` points the scope at the registry
and CI gets read auth the way landfall-ui's workflows do):

```jsonc
// package.json
"devDependencies": {
  "@dfox288/test-preset-vitest": "0.5.1",
  "@dfox288/test-gates": "0.5.1"
}
```

```ini
# .npmrc
@dfox288:registry=https://npm.registry.tastatur-und-maus.net/
```

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
Tests carry tags with `it(name, { tags: ['medium'] }, fn)`. Untagged tests in `unit` count as small, untagged tests in `nuxt` count as medium (they boot Nuxt), `e2e` is large.

### The shape test of `checks.map.yml`

A repo's whole test file for the map (version 2, `selection.md`) is one line, in a project that runs `small`:

```ts
// test/unit/checks-map.test.ts
import '@dfox288/test-preset-vitest/checks-map-test'
```

Vitest's static scan (`vitest list`, used by the gate's medium tier) reads a test file's own source, and a test behind an
import is not in it: a file of nothing but an import would stop the scan with `No test suite found`. So `defineTestConfig`'s
plugin expands a file that is exactly that import (comments around it are fine) into an `it` the scan sees, with the same
body; a file that has anything else in it is left as written (it registers the test by importing the module). The test
is one `it`, untagged, so small.

It reads `checks.map.yml` and `checks.kinds.yml` in the git top level (the project may run from a folder below it) and
the list of tracked files, and is red, naming the kind and the glob, when "Checks of the file" in `selection.md` is
broken: an unknown key; a kind missing from `checks.kinds.yml`; an `always` entry that is not a kind; a kind with
neither `always` nor `paths`; a glob that matches no tracked file; a catch-all glob (`*`, `**`); an edge whose `tests`
are not the kind's test files; `triggers` or `edges` on a kind without `narrow`; a `narrow` that is not a step in
`selection.md`. It also fails a `version` other than `2` and a key of the wrong type, so a file the gate would
refuse is red here first. `@dfox288/test-preset-vitest/checks-map` exports `checksMapProblems` and `readRepoFiles` for a
repo that wants the list itself. The fixture repos (`fixtures/checks-map/cases/`, one per rule) are run by the preset's own tests.
Globs are read as gitignore patterns, as `selection.md` says (a leading `/` or a slash inside the pattern anchors it; `**`).

## pytest

Installing the package loads the plugin (entry point `pytest11`). Markers `medium`, `large`, `protected`,
`quarantine`; `--strict-markers` and `--import-mode=importlib` are forced. `dfox288_test_preset.db.open_test_schema`
takes the repo's `connect(url)` (a DB-API connection) and gives a schema that is dropped on exit.
`dfox288_test_preset.net.free_port()` gives a free TCP port for a test's own server that cannot bind port 0 (a medium
test: a small one cannot open a socket).

### Parallel runs

The package depends on `pytest-xdist` and `pg8000` (exact pins), and a repo needs no conftest of its own for any of
this.

**The preset never imports its own dependencies into the process under test; where it needs one, it runs it in a child
process.** A repo may vendor its own `pg8000`, `scramp` and `asn1crypto` and test that they load from there; a driver the
preset had put into `sys.modules` would be the one its tests then ran on. So `pg8000` is imported only in
`python -I -m dfox288_test_preset.admin`, which the plugin and `dfox288_test_preset.db` start for a `CREATE DATABASE` or
`DROP DATABASE` (the URL by environment, never on the command line or in an error). A worker's `sys.modules` has none of
the three after the plugin's session start. A new dependency of the preset follows the same rule.

- **Parallel by default.** A run that sets no `-n` runs as `-n auto --dist=worksteal`. `-n0` runs in one process, `-n 3`
  and `--dist=loadfile` are kept as given, `-p no:xdist` and `--pdb` work as xdist defines them, and
  `PYTEST_XDIST_AUTO_NUM_WORKERS` sets the count. `auto` is one worker per core, at least 4 and at most 6: a database
  test waits on the server (commits, a `DROP DATABASE`'s checkpoint) as much as it computes, so 4 workers on 2 cores beat
  2, and past 6 the workers only queue on the server (lookout#164, medium tier: 75 s in one process, 25 s with 6
  workers; at 8 the first drops took 11 to 13 s of the 15 s limit). A focused run of one file starts the same workers;
  use `-n0` for it. `worksteal` beat `load` by about 10% there; `xdist_group` is not honoured under `worksteal`
  (only `--dist=loadgroup` groups), so a run that needs groups says so.
- **The count guard is the controller's.** Under xdist the controller sees every report and collects nothing, so each
  report carries its test's tier, `quarantine` and `protected` marks, read from the markers in the worker that ran it
  (not from a directory or file name). Only the controller writes the run summary; the line, the summary file and the
  gate's counts are the same as in one process. Before this the controller counted every test as small and the gate read
  "ran zero medium tests".
- **A database per worker.** On an xdist worker with `TEST_DATABASE_URL` set, the worker creates an empty database
  `dfox288_worker_<run>_<worker>` (from `template0`) on that server when it starts, sets `TEST_DATABASE_URL` to it for
  itself and the processes it starts, and drops it (`WITH (FORCE)`) at its end; the controller drops any of the run's
  databases a crashed worker left. The role needs `CREATEDB`. Nothing is created without xdist (`-n0`, `-p no:xdist`) or
  without the variable. If a worker cannot create its database, each of its tests errors with the reason (never the URL)
  and `-n0` is the way out. A test reads `TEST_DATABASE_URL` when it runs, never at import. The database is empty:
  tests still take a schema each (`open_test_schema`) and migrate into it; a template migrated once per worker is not
  part of this release.
- **The test Postgres can skip fsync.** `-c fsync=off -c synchronous_commit=off -c full_page_writes=off` on the
  container only (throwaway data) took lookout's medium tier from 26 s to 15 s on Docker for Mac, where each `DROP
  DATABASE` waits for a checkpoint. It is the Postgres service's setting, not the preset's: Current's service and a
  repo's own CI Postgres pass the flags.
- **Own server ports.** A test's server binds port 0 and reads the port it got; `free_port()` is for one that must be
  told its port, and has the race of any free-port probe (retry on `EADDRINUSE`).

## Contract check for fakes

A fake of an outside service has one test that it still has the real thing's shape (`testing.md`). Record a real answer
once, on purpose, then compare the fake's answer with it; only the shape counts (kinds, object keys, array element
shape), never values.

```ts
import { expectShape, recordAnswer } from '@dfox288/test-preset-vitest/shape'

// the repo's record command (a script that talks to the real service; the only place that writes)
recordAnswer('test/recorded/run.json', await realService.run())

// the contract test
it('the fake answers in the real shape', () => {
  expectShape(fakeService.run(), 'test/recorded/run.json') // throws listing `$.path: what` for each difference
})
```

```python
from dfox288_test_preset.shape import expect_shape, record_answer

def test_fake_answers_in_the_real_shape():
    expect_shape(fake.run(), "tests/recorded/run.json")
```

A recorded array stands for any number of elements of the shape all its elements share (an empty one accepts any
element); a key some recorded elements lack is optional; an undefined value counts as an absent key. A test run never
writes a recording: a missing file fails and names `recordAnswer` / `record_answer`.

## Commit hooks

One hook per toolchain, shipped in the package a repo already pins, so a repo copies no rules and no config
(`testing.md`: format, lint and typecheck run in the hook; a red hook is fixed, not bypassed). Both run offline, from what
the repo's install brought (Current runs the hook in a worker container without a network), never run a test, format and
re-stage the staged files, refuse a partly staged file by name (formatting it would stage its unstaged hunks too), and
name the file and the rule when a tool fails. `PRESET_HOOK_TIMING=1` prints each step's seconds.

**Nuxt / TypeScript** (`@dfox288/test-preset-vitest`): Prettier (`--ignore-unknown --write`), then ESLint
(`--no-warn-ignored`, no fix) on the staged files, then the typecheck when a `.ts`, `.mts`, `.cts`, `.vue` or
`tsconfig*.json` is staged. The typecheck is `vue-tsc -b --noEmit` when `tsconfig.json` has `references` (what `nuxt
prepare` writes; the build mode keeps one `.tsbuildinfo` per project), else `vue-tsc` or `tsc --noEmit --incremental`
with one build-info file under `node_modules/.cache/dfox288-pre-commit/`. The tools are the repo's own `prettier`,
`eslint` and `vue-tsc` in `node_modules/.bin`, with the repo's configs; a missing one fails the hook with its name. ESLint
configs that import `.nuxt` need `nuxt prepare` to have run, as for the rest of the repo. Wire it with one line:

```sh
git config core.hooksPath node_modules/@dfox288/test-preset-vitest/hooks     # web/node_modules/... for an app below the root
# or .githooks/pre-commit:   exec pnpm exec dfox288-pre-commit [--dir web]
```

The `hooks/pre-commit` file finds its project folder from where the package sits (`web/node_modules/...` means `web`);
`--dir` (or `PRESET_HOOK_DIR`) names it for the other form. Only staged files below that folder are looked at.

**Python** (`dfox288-test-preset`): `ruff format` then `ruff check --no-fix` on the staged `.py` files. No type checker. `ruff` is
pinned by the preset (`ruff==0.16.10`), so the repo's `uv sync --group test` has it and the hook calls `python -m ruff`
of the same environment. The settings ship in `dfox288_test_preset/ruff.toml` (`line-length = 120`, `target-version
= "py314"`, rules `E4 E7 E9 F I`); the repo's own `[tool.ruff]` in `pyproject.toml`, or its `ruff.toml` /
`.ruff.toml`, overrides them key by key (a key the repo sets wins, the rest stays the preset's; the repo's `exclude`
and `extend-exclude` apply to staged files too). Wire it:

```sh
# .githooks/pre-commit        (git config core.hooksPath .githooks)
exec uv run --no-sync --group test dfox288-pre-commit [--dir api]
```

## Gates

`gates.config.json` in the repo: `{ "stack": "vitest" | "pytest", "gates": { "lint": ["pnpm", "lint"], ... } }`; then
`test-gates` (or `test-gates --only=small,medium`). Gate names: `lint`, `format`, `typecheck`, `docs`, `small`, `medium`,
`large`, `build`. `lint` and `format` red stop the run. A tier below its floor in `test-floors.json`, one that ran
zero tests and one whose run wrote no summary (the preset did not run) are red; `--raise-floors` raises the floors
after a green run and never lowers them. The last line is `GATE GREEN (...)` or `GATE RED: <gate (reason)>, ...`.

On the Vitest stack the medium run of the tag-selected projects (`unit`, not `nuxt`) takes its files from a static scan,
`vitest list --tags-filter medium --project <p> --json` (Vitest 5; about 2 s, sets up no file), and runs only those, with
`--tags-filter` still on the run. Without it Vitest sets up every file of the project to run the few medium ones. Counts,
floors and the summary are unchanged. A scan that fails (cannot start, non-zero exit, no JSON) is red with the reason
(`vitest list failed: ...`), never a silent full run or a run of nothing. The small tier is not scanned. A medium test whose tag the static scan cannot read (the tag set through a variable, say) would not be
selected and would never run, so the gate cross-checks: the small run collects every file, the preset's summary lists the
files where it saw a medium-tagged test (`mediumFiles`, skipped ones included), and the medium gate is red, naming each
file, when the scan did not select one of them. The check needs the small run's list, so the scan is used only when it exists: with `--only=medium` alone, a `commands.small`
override or a preset whose summary has no `mediumFiles`, the medium run is not scanned (it collects every file, as before)
and the gate prints one line saying so.

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

### Narrowed runs (`--related`, `--tests`)

For a kind with `narrow: vitest-related` (`selection.md`, rule 6) Current passes the changed files and the changed test
files instead of running the tier whole:

```
test-gates --only=small,medium --related=web/app/utils/filter.ts --tests=web/test/unit/age.test.ts
```

- `--related=<file>` (repeatable) is a changed file; the Vitest tiers `small` and `medium` run `vitest related --run
  <files>` with their usual `--project` and `--tags-filter`, so the tests that import the file run (and a test file given
  runs itself). `large` never takes it: e2e has no narrowing step, it runs whole or not at all.
- `--tests=<file>` (repeatable) is a test file, for every tier of the run; `--small-tests=`, `--medium-tests=` and
  `--large-tests=` give one tier's files only. A tier given only test files runs `vitest run <files>`
  (pytest: `pytest -m <marker> <files>`). A tier given nothing runs whole.
- Paths are taken relative to the working directory (Current runs the gate from the kind's `dir`), must be inside the
  repo, and a test path must exist (a usage error, exit 2, otherwise).
- A narrowed tier is neither scanned nor floor-checked: the floors and the cross-check describe a whole tier. A narrowed
  run that selects no test is a skip, not a red: `gates: medium: narrowed: no medium test is related to the selected files
  (changed files: ...)`, and the gate can still be green (selection.md: "a selection of zero tests skips the kind"): the
  table shows the tier as skipped with that reason. A mixed run (one tier skipped, another green) is green and exits 0. A
  narrowed run in which no tier ran a test and nothing is red ends `GATE SKIPPED: narrowed run, no tier selected a test`
  and exits **66**; Current records that as a skip. `--raise-floors` is refused with either flag.
- Exit codes: 0 green; 1 red; 2 a usage error; 66 as above (never on a run without `--related` or `--tests`). A path outside
  the directory the gate runs in starts with `../`; it must still be inside the repository.
- pytest has no narrowing step (`selection.md`): `--related` on the pytest stack, or on a tier with a `commands`
  override, is a usage error. `--tests` works on both.

### The docs gate

`docs` is red when a doc names something the diff took away. It compares `HEAD` with `--base=<ref>` (default
`origin/main`, or `docs.base`), collects the paths the diff removes or renames (a directory with no file left counts)
and the `package.json` / `pyproject` `[project.scripts]` names it removes or renames, and looks for them in
`README.md`, `docs/**/*.md` and `CLAUDE.md` as a backticked path, a link target, or (scripts) a backticked
`pnpm <name>` / `pnpm run <name>` / `npm run <name>` / `yarn <name>` / `uv run <name>`. Output:
`file:line: names <old>, which this change removed|renamed to <new>`. `test-gates --only=docs --all` is the full scan:
every backticked path in those files that is not in the tree (fenced blocks skipped). Optional config:

```jsonc
"docs": { "base": "origin/main", "globs": ["notes/*.md"], "ignore": ["dist/*", "src/legacy.ts"] }
```

With no base to compare (no `--base`, no `origin/main`) the gate is red, `NOT MEASURED: no base to diff against (pass
--base or --changes)`; so is a failing `git merge-base` (shallow clone) and a `--base` that does not resolve. It never
falls back to the full scan. `--changes=<file>` takes a `git diff --name-status -M` style list (`R<score>\told\tnew`,
`D\tpath`, `M\tpath`) and needs no git history (the docs are read from the work tree; script removals need the old
`package.json`, so only paths are seen). A bare `<this repo's name>/` in a doc is not a hit when a local folder of that
name moved (another repo's folder of the same name); paths inside it (`lookout/deploy.yaml`) are, so add them to
`docs.ignore` (`"lookout/*"`).

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
uses private members of pytest, pytest-timeout and `tempfile`, and sets pytest-xdist's `numprocesses` and `dist` options
and reads its `workerinput` (`workerid`, `testrunuid`); those are pinned the same way, and Python is 3.14.

## Proof

`.github/workflows/test-presets.yml` runs `check:dist`, the Vitest preset's unit tests (reporter, the map's shape test, the Nuxt hook), the gate script's unit tests, the pytest preset's own tests (they
start pytest, in parallel and not, against the Postgres service; the Python hook among them) and the four break-it runs on every pull
request and push to main. `fixtures/break-it.ts` plants each violation and checks the run is red for the stated reason:

```
TEST_DATABASE_URL=postgres://... node test-presets/fixtures/break-it.ts <vitest|pytest|gates|gates-pytest> [filter]
```

`refresh-nuxt.sh` and `refresh-pytest.sh` reinstall a changed preset into its fixture.
