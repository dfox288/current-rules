# Test-presets changelog

## Unreleased

## 0.5.1 (2026-10-09)

- Vitest preset: the shape test as a one-line import file no longer stops the medium tier's static scan (horizon-surveyor#320).
  In 0.5.0 a test file that was only `import '@dfox288/test-preset-vitest/checks-map-test'` made `vitest list --tags-filter
  medium` fail with `No test suite found in file ...` (the scan reads a file's own source, and the test sat behind the
  import), so the test gate was red. `defineTestConfig`'s plugin now expands exactly that file into an `it` the scan sees; the
  test is one `it` (it was two), untagged. A file with anything else in it is unchanged. New export `./checks-map-body`
  (`checksMapTest`, the test's body). A repo's file stays one line; nothing to change but the repin.
- pytest preset, the commit hook: a repo's ruff table with several entries is honoured whole. 0.5.0 passed the repo's
  settings as one dotted `--config` override per key, and ruff keeps only the last override for a table, so a
  `[tool.ruff.lint.per-file-ignores]` with more than one entry applied only its last (a commit that plain `ruff check`
  passes was refused). A table of plain values (`per-file-ignores`, `isort`, `format`) is now passed as one inline table.
- pytest preset, the commit hook: the wiring is two lines. A first line, `git diff --cached ... | grep -q '\.py$' || exit 0`,
  ends a commit with no staged `.py` file before `uv` or ruff start, so a container without `uv` is not refused for a
  web-only commit; a `.py` commit there still fails loudly. README "Commit hooks" and `bindings/python.md` show it; a test reads the
  README block and commits through it.
- Gate script: version only, no change.

## 0.5.0 (2026-10-09)

Shared commit hooks, the gate script's narrowed runs and the shape test of `checks.map.yml` version 2 (horizon-surveyor#318;
rulings R110, R139, R142, R144). All three packages move to 0.5.0. A repo gets each piece by a repin; nothing changes for a
repo that uses none of them.

- Commit hooks, one per toolchain, shipped in the package a repo already pins (`README.md`, "Commit hooks"). Offline, no
  tests, formatted files re-staged, a partly staged file refused by name.
  - `@dfox288/test-preset-vitest`: `hooks/pre-commit` and the `dfox288-pre-commit` bin run Prettier and ESLint on the
    staged files and an incremental typecheck (`vue-tsc -b --noEmit` under project references). New export `./hook`.
  - `dfox288-test-preset`: the `dfox288-pre-commit` script runs `ruff format` and `ruff check` on the staged `.py` files
    with the settings shipped in `dfox288_test_preset/ruff.toml`; the repo's `[tool.ruff]` / `ruff.toml` overrides single
    keys. `ruff==0.16.10` is now a dependency of the package. No Python typecheck (R144).
- Gate script: `--related=<file>`, `--tests=<file>`, `--small-tests=`, `--medium-tests=`, `--large-tests=` (repeatable). A
  Vitest tier given `--related` runs `vitest related --run <files>` (a test file given runs itself); test paths alone
  run `vitest run <files>`; a narrowed tier is not scanned or floor-checked and, selecting nothing, is skipped with the
  changed files named, not red; a narrowed run in which no tier ran a test and nothing is red exits 66 (a mixed run
  stays 0), the contract of `selection.md`, "The gate script's arguments". `large` is never narrowed; `--raise-floors` is refused with either flag; `--related` on the
  pytest stack or on a `commands` tier is a usage error. A run without the flags is unchanged.
- Vitest preset: the shape test of `checks.map.yml` version 2. A repo's test file is
  `import '@dfox288/test-preset-vitest/checks-map-test'`; it is red on every rule of `selection.md`, "Checks of the file".
  New exports `./checks-map` and `./checks-map-test`; new dependency `yaml` (2.9.1).

## 0.4.1 (2026-10-09)

- pytest preset: the worker databases are made and dropped in a child process (ruling R133, from lookout#165). 0.4.0
  imported its own `pg8000` (and `scramp`, `asn1crypto`) into every xdist worker that had `TEST_DATABASE_URL`, so a repo
  that vendors its own driver ran its tests on the preset's and failed its vendor test (`asn1crypto loaded from outside
  _vendor`). Now `pg8000` stays a dependency of the package but is imported only in `python -I -m
  dfox288_test_preset.admin`, a child process; after the plugin's session start the three are not in the worker's
  `sys.modules`. A repo needs no change but the repin.
  - `create_database`, `drop_database` and `drop_databases_starting_with` keep their signatures and go through the same
    child process (the URL by environment, never on the command line or in an error message; a failure raises
    `dfox288_test_preset.db.DatabaseAdminError`). The child costs about 75 ms more per call than an in-process call (90 ms
    per create, 80 ms per drop, against a local Postgres): about 0.3 s per run. `open_test_schema` stays driverless.
  - `admin_connect` is no longer public (R140): no repo used it, and it imported the driver into its caller. The
    preset's own tests take the connection from `dfox288_test_preset.admin`.
  - The rule is in `README.md` ("Parallel runs"): the preset never imports its own dependencies into the process under
    test.
- gate script and Vitest preset: version only, no change.

## 0.4.0 (2026-10-09)

- pytest preset: parallel runs, from what lookout#164 learned (ruling R116). A repo gets all of it by a repin and removes
  its own xdist conftest parts (see `README.md`, "Parallel runs"). The package now depends on `pytest-xdist==3.8.0` and
  `pg8000==1.31.5` (the second only for the worker databases below; `open_test_schema` still takes the repo's driver).
  - A run that sets no `-n` runs as `-n auto --dist=worksteal`; `auto` is one worker per core, at least 4 and at most 6.
    `-n0`, an explicit `-n N`, `--dist=...`, `-p no:xdist` and `PYTEST_XDIST_AUTO_NUM_WORKERS` are the run's own say. A
    repo that must stay serial for now passes `-n0` (or `addopts`); a test that collides under parallel fails and is fixed
    (testing.md, "What a test may fake"; bindings/python.md, "Parallel runs").
  - The count guard is correct under xdist: each report carries its test's tier, `quarantine` and `protected` marks
    (`report.preset_marks`, from the markers in the worker), the controller counts from them, and only the controller
    writes the run summary. Before, the controller counted every test as small and a worker's partial summary could
    overwrite the file. The preset's private `_tiers` dict is gone: a repo's shim on it (lookout's `tests/conftest.py`)
    must be removed with the repin.
  - A database per worker: on an xdist worker with `TEST_DATABASE_URL` set, `dfox288_worker_<run>_<worker>` is created
    from `template0` at the worker's start, `TEST_DATABASE_URL` points at it for the worker and its subprocesses, and it
    is dropped `WITH (FORCE)` at the end; the controller drops a crashed worker's. Nothing is created without xdist or
    without the variable; a worker that cannot create its database errors its tests with the reason, never the URL. The
    role needs `CREATEDB`. New in `dfox288_test_preset.db`: `database_url`, `create_database`,
    `drop_database`, `drop_databases_starting_with`.
  - `dfox288_test_preset.net.free_port()`.
  - A test that sets its own timeout now fails in setup with the message instead of aborting the run as a usage error: a
    worker that raises while collecting takes an xdist run down with an INTERNALERROR and no message.
  - Not done: a template database a repo migrates once per worker (a test still migrates into its own schema); the
    Postgres service's `fsync=off` (Current's service, README).
- gate script and Vitest preset: version only, no change.

## 0.3.0 (2026-10-07)

- both presets: the shape-compare helper for outside-service fakes (`testing.md`, "What a test may fake": each fake has a
  contract check). It compares a fake's answer with a recorded real answer by shape, never by value: the kind of each
  value (null, boolean, number, string, array, object), the keys of each object, and the shape of an array's elements
  (every element is checked; a key some recorded elements lack is optional). Vitest: `@dfox288/test-preset-vitest/shape`
  exports `expectShape(actual, file)`, `shapeDiff(actual, recorded)`, `loadAnswer(file)`, `recordAnswer(file, answer)`.
  pytest: `dfox288_test_preset.shape` exports `expect_shape`, `shape_diff`, `load_answer`, `record_answer`. A mismatch
  lists every difference as `$.path: what`; a missing recording fails and is never created by a test run. The recording
  is a JSON file written only by `recordAnswer` / `record_answer`, which a repo calls from its own record command (the one
  that talks to the real service); that command is the explicit re-record. Nothing changes for a repo that does not
  import it.

## 0.2.0 (2026-10-06)

- vitest preset and gate script: Vitest 5. The peer `vitest` is `5.0.3` (exact, as before: the reporter and plugin use members
  Vitest does not type); an app repins `vitest`, `@vitest/ui` and `@vitest/coverage-v8` to 5.0.3 with it. Vitest 5 needs
  Node >= 22.12, Vite >= 6.4 and `@nuxt/test-utils` >= 4.3.2. Its default changes reach tests, not the preset: `clearMocks`
  is on, a happy-dom/jsdom window is mutable (`globalThis.navigator = ...` now throws, use `Object.defineProperty`), a
  hoisted `vi.mock` outside the top level throws, an unawaited `resolves`/`rejects` fails the test.
- gate script, Vitest stack: the medium run of the tag-selected projects (`unit` and the like; not `nuxt`, which already
  runs whole) is restricted to the files `vitest list --tags-filter medium --project <p> --json` names. That scan is
  static (about 2 s) and sets up no file, where `--tags-filter` on a run sets up every file of the project first (beacon:
  612 files to run 22). The run keeps its `--tags-filter`, so counts, floors, protected counts and the summary are the
  same as before. A `vitest list` that cannot start, exits non-zero or prints no JSON turns the tier red with the reason
  (`vitest list failed: ...`); a scan that finds no file runs nothing and the tier is red as a zero-test tier; neither
  falls back to a full run. The small tier is not scanned (it would save the setup of a few medium files, and a file
  whose tests are all generated, such as `it.each`, is invisible to the static scan). A medium test the scan cannot read (its tag
  set through a variable) is caught by a cross-check: the preset's run summary gains `mediumFiles` (files where the run
  saw a medium-tagged test in a unit-like project, skipped ones included), and when small and medium run together the
  medium gate is red, naming the files, if the scan did not select one of them. The scan is used only when the
  cross-check can run: with `--only=medium` alone, a `commands.small` override, or a summary without `mediumFiles` the
  medium run is not scanned (every file is collected, as before) and the gate says so in one line. A `commands.medium` override still
  replaces the whole selection.
- release: `presets-release.yml` publishes both npm packages to the private registry on a `presets-v*` tag; both `package.json`
  files carry `publishConfig.registry`. (horizon-surveyor#123)
- gate script, both stacks: a new gate `docs` (runs after `typecheck`, before the tiers). It compares the tree with its
  base (`--base=<ref>`, default `origin/main`; `docs.base` in `gates.config.json`) and is red when `README.md`,
  `docs/**/*.md` or `CLAUDE.md` still name, in backticks or as a link target, a path the diff removed or renamed, or a
  `package.json` / `pyproject` (`[project.scripts]`) script it removed or renamed. Each hit is
  `file:line: names <old>, which this change removed|renamed to <new>`. `--all` is the full scan: every backticked path
  in those files that is not in the tree (fenced blocks skipped). `docs.globs` adds doc files, `docs.ignore` keeps a
  name. With no base to compare against (no `--base`, no `origin/main`) and no `--changes`, the gate is red with
  `NOT MEASURED: no base to diff against (pass --base or --changes)`; it never falls back to the full scan. A failing
  `git merge-base` (no common ancestor, shallow history) and an explicit `--base` that does not resolve are the same
  red. `--changes=<file>` takes a `git diff --name-status -M` style list (`R<score>\told\tnew`, `D\tpath`) and needs
  no history (paths only: a script removal cannot be seen without the old package.json). A bare `<repo-name>/` in a
  doc does not count as a hit for a moved folder of that name; `docs.ignore` handles paths inside it. A repo gets the gate by repinning `@dfox288/test-gates`; its
  first run may be red on lines that were already stale, which the repin commit fixes. The rule is in
  `dfox288/standard.md`, "Docs and changelog". (horizon-surveyor#149)

## 0.1.5 (2026-10-05, never tagged: shipped in 0.2.0)

- rename: `presets/` is now `test-presets/`, and the release tag prefix is `test-presets-v*` (this release: `test-presets-v0.1.5`);
  `.github/workflows/presets.yml` and `presets-release.yml` are now `test-presets.yml` and `test-presets-release.yml`.
  Package names are unchanged. Nothing else changed; the versions are bumped to 0.1.5 to match the tag.
  Apps move from the GitHub tarball pins (`github:dfox288/current-rules#presets-v0.1.4&path:/presets/...`) to the
  registry versions (`0.1.5`); the pytest package stays a git dependency (`subdirectory = "test-presets/pytest"`,
  `tag = "test-presets-v0.1.5"`). (horizon-surveyor#183)

## 0.1.4 (2026-10-04)

- vitest preset: an untagged test in the `nuxt` project counts as medium, not small. A `nuxt` test boots Nuxt
  (`mountSuspended`), which `testing.md` calls medium ("an app or server booted in-process"). An untagged `unit` test is
  still small, and the `medium` tag still makes a `unit` test medium. The guards are unchanged: an untagged `nuxt` test
  still runs under the small guards (no network, writes only in the temp dir, no database), so one that needs those
  still carries the `medium` tag. `bindings/nuxt-ts.md` says the same.
  What an app does when it repins: its small floor drops by its `nuxt` test count and its medium floor rises by the
  same number, in the repin commit (the new count shows in the first gate run). The gate never raises a floor by hand.
  The gate script changes with it, so repin the preset and the gate script together: the small run covers the other
  projects (`--tags-filter '!medium'`), the medium run is two runs added into one summary (the other projects with
  `--tags-filter medium`, then the whole `nuxt` project), so what runs in a tier is what is counted in it.
  A repo whose `gates.config.json` sets its own `commands` must do the same split itself.
- both presets: the `protected` tag and marker descriptions follow the overseer-approval rule (the overseer approves
  changes; a removal or weakening needs an independent reviewer's check and is named in the item).
  (horizon-surveyor, testing.md tiers)

## 0.1.3 (2026-10-03)

- gate script, both presets: the gate summary reports the protected count per tier, one stable line per tier
  (`small: 437 tests, 41 protected`). The presets write `protected` per tier into the run summary (pytest: the
  `protected` mark on a test, its class or its module; Vitest: the `protected` tag, also inherited from a `describe`),
  so the count comes from the tier's own run. Reported only; floors are unchanged. A summary from an older preset
  prints `protected not reported`. A repo gets it by repinning both the preset and the gate script to the next tag.
  (horizon-surveyor#113)

## 0.1.2 (2026-10-03)

- vitest preset: the fetch guard resolves a relative URL against `globalThis.location` when there is one, then judges
  the host as before. A relative URL with no location stays refused; an absolute non-loopback URL is still refused in
  medium, and every fetch is still refused in small. (horizon-surveyor#81)
- pytest preset: the small tier's write guard judges the removal of a symlink (`os.remove`/`os.unlink`) by the link's
  own path, not by its target, so a test may remove a link it made inside its `tmp_path`. A write through a link to
  outside the allowed roots is still a violation. (horizon-surveyor#78)

## 0.1.1 (2026-10-03)

- pytest preset: the small tier's write guard allows importlib's atomic bytecode temp file
  (`__pycache__/<name>.pyc.<digits>`) as well as `__pycache__/<name>.pyc`, so a lazy stdlib import in a fresh
  interpreter no longer fails the test. No wider exemption: other names under `__pycache__` and a `.pyc.<digits>`
  name elsewhere are still violations. (horizon-surveyor#76)
