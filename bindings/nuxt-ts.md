# Binding: Nuxt and TypeScript

How a Nuxt app, a published layer or a TypeScript toolchain meets `testing.md`. Where Nuxt or Vitest documents a
scheme, this file follows it (D-358).

## Layout and names

*(The contract items here are checked by the conformance script, not built yet: horizon-surveyor#70; until then the
reviewer checks them.)*

- **[contract item]** Tests live in Nuxt's documented folders, each a Vitest project of the same name: `test/unit`
  (Node, no Nuxt runtime), `test/nuxt` (the Nuxt runtime, set up with `defineVitestProject` from
  `@nuxt/test-utils/config`), `test/e2e` (a built app on a port, a browser).
- **[contract item]** Tiers map onto them: an untagged test in `unit` or `nuxt` is small; a test there that touches a
  database, files or an in-process server carries the Vitest tag `medium`; everything in `e2e` is large. There is no
  medium folder or project.
- **[contract item]** One script, `"test": "vitest"`, as Nuxt documents. No `test:*` scripts except the opt-in
  `test:coverage`. The shared gate script selects tiers with `--project` and `--tags-filter`.
- **[rule]** A focused run always names files: `pnpm test <file>`, never `pnpm test -- <file>` (the script swallows
  the `--`). Only the gate script runs a whole tier. Read the `Test Files` count: `--exclude` is ignored under
  `projects`, and `--project <name>` with a name Vitest never assigned selects nothing.

## The preset

Each repo installs the Vitest preset and the shared gate script from the public preset repo, as a git dependency
pinned to a tag, and adds only its project list and its justified differences. *(Not built yet: horizon-surveyor#69. Until a repo has migrated, its own scripts and README
apply.)*

The preset sets:

- **Time limits per test:** small 5 s (Vitest's default `testTimeout`), `medium` tag 15 s, `e2e` project 30 s. The
  setup-hook limit (`hookTimeout`) covers the `e2e` build.
- **Retries:** none in `unit` and `nuxt`; at most one in `e2e`, a pass on the retry reported as flaky.
- **Tags:** `medium` and `protected`, defined once. `pnpm test --tags-filter=protected` lists the protected tests.
- **`TZ=UTC`.**
- **Small's guards:** an outgoing network connection fails the test; a write outside the test's temp dir fails it;
  `TEST_DATABASE_URL` is empty for untagged tests, so the DB helper throws. Sleep and server boot are not guarded;
  the reviewer checks them.
- **The count guard:** every run states the files and tests it ran; a tier below its floor fails.
- **The `e2e` build:** the app is built once per run and reused by every `e2e` file; a run that selects no `e2e` file
  does not start it.

## Databases

- **[rule]** A server database (today: Postgres) comes from the environment as `TEST_DATABASE_URL`, on the engine
  production uses; tests never start a container. The preset's DB helper gives each test or file its own schema or
  database and drops it afterwards. An app that ships an in-process database (SQLite) tests on it directly: in memory
  or a file per test file.

## Tool traps

- **[rule]** Vitest's default reporter hides the console output of passing tests: a count of warnings (deprecations,
  runtime warnings) needs `--reporter=verbose` and a control that puts one known-bad use back. A test that renders no
  component can't see a runtime warning at all: report that count as "not measured". In `@nuxt/test-utils`,
  `captureServerLogs` swallows server warnings; turn it off for a count. *Check: reviewer reads a warning count for
  its reporter and its control.*
- **[rule]** Coverage (`test:coverage`, `@vitest/coverage-v8` on the repo's Vitest version line, report under
  `.tmp/coverage`) doesn't measure code a test runs in another process (a booted server, a child process) or `.vue`
  files the config doesn't include: a coverage figure says what it left out. *Check: reviewer reads a coverage figure
  for what it leaves out.*
- **[rule]** `vitest related` helps find the focused test but never decides alone: it can't see HTTP requests or files
  read as text, so a server-route change selected 0 files in two repos. *Check: reviewer reads a `related` selection
  against the files the change reaches.*
- **[rule]** An `e2e` test runs against the built output (stale output passes: build first), binds `127.0.0.1` (never
  `listen(0)` without a host), takes a free port, waits for finite animations to end instead of a fixed timeout, and
  for a phone uses `hasTouch` without `isMobile` (`isMobile` reports 449 for 402) and asserts `innerWidth`. It measures
  what happy-dom can't: hit-tests (`elementFromPoint` at a control's centre), geometry, real pointer and key input,
  focus after a close, computed values (not class lists). *Check: reviewer reads a new `e2e` file against this list.*
- **[rule]** A shared type (an error class) lives in its own module, not inside a service that many routes import, or
  a change to the service drags their tests into every focused run. *Check: reviewer reads where a new shared type
  lives.*
