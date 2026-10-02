# Trait: `nuxt-app`

Your repo is a Nuxt app or layer. These are the framework traps that have already bitten, as checkable
statements.

## Rules

- **[rule]** NuxtUI's theme cascade: check the documented pattern for how a component's theme tokens flow before
  overriding one by hand. *Check: reviewer reads a theme override for whether it fights the cascade instead of
  working with it.*
- **[rule]** Colour-mode-dependent rendering goes through `<ClientOnly>` (or the repo's established equivalent) —
  not a raw `useColorMode()` read during SSR. *Check: reviewer reads new colour-mode-conditional markup for
  hydration-mismatch risk.*
- **[rule]** Tailwind v4 tokens are used as documented (the design tokens, not ad hoc utility stacking that
  fights them). *Check: reviewer reads new class lists against the token set.*
- **[rule]** Pinia stores use the composition syntax the codebase already uses, not the options-style API mixed
  into a composition-style store. *Check: reviewer reads new/changed store code for consistency with the
  surrounding file.*
- **[rule]** Vitest's default reporter hides the console output of passing tests: a count of warnings (deprecations,
  runtime warnings) needs `--reporter=verbose` and a control that puts one known-bad use back. A test that renders no
  component can't see a runtime warning at all: report that count as "not measured". In `@nuxt/test-utils`,
  `captureServerLogs` swallows server warnings; turn it off for a count. *Check: reviewer reads a warning count for
  its reporter and its control.*
- **[rule]** Run tests through the package script (`pnpm test <file>`), not a bare `vitest run`: the script can set
  the environment the tests need. `--exclude` is ignored when the config uses `projects`, and `--project <name>` with
  a name Vitest never assigned selects nothing: pass files by name and read the `Test Files` count. *Check: reviewer
  reads the focused run's count against the files named.*
- **[rule]** Only a build compiles templates: typecheck and unit tests don't. A change to a template, config or
  routes needs the repo's build (or the check that covers it) before you call it done. *Check: reviewer reads the
  report for the build on a template or config change.*

## Tests

- **[rule]** A repo's test scripts are `test` (everything), `test:app` (unit and component tests: node, happy-dom,
  `@vitest-environment nuxt`, `mountSuspended`; nothing that boots a dev server, Nitro or a container) and `test:e2e`
  (tests that boot the app or a service: a dev server, `$fetch` against it, Docker, a browser). How a repo builds the
  split (projects, includes, tags) is its own; a tier with nothing in it still has its script. Tests on real local I/O
  (temporary git repos, SQLite files) stay in `test:app`. A repo with a second language and a `test` that covers only the
  JS runner also defines `test:sweep`: every tier in every language, stopping at the first failure; its README says what
  it costs. *Check: reviewer reads `package.json` scripts when the diff adds or renames a test script.*
- **[rule]** Pick the checks by the change. Tests, docs, comments or CSS values only: the focused test. Logic in one
  module or component: plus `typecheck`. A template, `nuxt.config`, a new auto-import, a route, middleware, auth or env
  handling: plus `typecheck` and `build`, and `test:e2e` for a route, middleware, auth or env change. The focused test is
  `pnpm test <file>`, never `pnpm test -- <file>` (the script swallows the `--`); read the `Test Files` count. A break-it
  runs its one test. *Check: reviewer reads the report's checks against the diff's kind.*
- **[rule]** `vitest related` helps find the focused test but never decides alone: it can't see HTTP requests or files
  read as text, so a server-route change selected 0 files in two repos. *Check: reviewer reads a `related` selection
  against the files the change reaches.*
- **[rule]** No test reads source as text (`readFileSync('app/...vue')`): test selection can't see it. Use a build lint
  or a real mount. A shared type (an error class) lives in its own module, not inside a service that many routes import,
  or a change to the service drags their tests in. *Check: reviewer greps new tests for `readFileSync` on source files.*
- **[rule]** A protected test (see the base standard) carries the `protected` tag (Vitest 4.1 test tags), defined once
  in the config (`test: { tags: [{ name: 'protected', description: '...' }] }`) and set on the `describe` or `test`
  (`{ tags: ['protected'] }`); `pnpm test --tags-filter=protected` lists them and its count must be non-zero. A tagging
  pass covers every test file, not the examples an issue names: search the whole suite for issue references and break-it
  phrasing (`break-it`, `seen red`, `regression guard`), classify by what a test asserts (secret-leak and
  last-good-data guards are written in plain English and cite nothing), and report files total and files read; the two
  must match. The search needs a control that fires. *Check: reviewer reads the report for both file counts and the
  control.*
- **[rule]** Coverage is an opt-in `test:coverage` (`@vitest/coverage-v8` on the app's Vitest version line, report under
  `.tmp/coverage`), out of the gates, with no thresholds. Say what it didn't measure: code a test runs in another
  process (a booted dev server, a child process), and `.vue` files the config doesn't include. *Check: reviewer reads a
  coverage figure for what it leaves out.*
- **[rule]** A browser check that stays true becomes a Playwright test in `test:e2e`, in the same branch, instead of a
  probe written again each time. e2e measures what jsdom can't: hit-tests (`elementFromPoint` at a control's centre),
  geometry at 402 and 1440, real pointer and key input, focus after a close, computed values (not class lists). Build
  before serving (stale output passes), bind `127.0.0.1` (never `listen(0)` without a host), take a free port, wait for
  finite animations to end instead of a fixed timeout, and for a phone use `hasTouch` without `isMobile`
  (`isMobile` reports 449 for 402) and assert `innerWidth`. *Check: reviewer reads a new e2e file against this list.*

## What this trait does not cover

A trap not listed here follows the base standard's framework-traps rule: look for the pattern in the surrounding
code before improvising. This file is a list of the traps that have already bitten, not an exhaustive framework
guide.
