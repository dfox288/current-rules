# The testing baseline

Every repo Current manages follows this file, in any stack, nx included. Its rules are stack-neutral; how a stack
meets them is in that stack's binding (`bindings/<stack>.md`). A realm's `standard.md` and traits may add to this file,
never relax it. A repo's justified differences (a different database engine, private data) are recorded in that repo's
own trait, not here. How the system runs the tests (when each tier runs, coverage and mutation, how repos stay on
this file) is in `testing-system.md`, which is not part of a worker's prompt.

Where a framework we use documents a scheme (names, layout, setup), the binding follows it; this file adds rules only
where the framework says nothing (D-358).

Each rule is tagged **[contract item]** (a gate or the conformance script checks it) or **[rule]** (the reviewer
checks it reading the diff and report).

## Tiers

A test's tier is set by what it may touch, not by how much code it covers.

- **Small:** nothing outside the process. No network, no database, no files outside its own temp directory, no sleep,
  no server or container boot. In-process framework environments are allowed. It may read checked-in repo files
  (fixtures, configs, source) read-only; writing outside its own temp directory, the network, a database or a server
  makes it medium.
- **Medium:** localhost. A real database, files, an app or server booted in-process.
- **Large:** a built app on a port, a browser, or several processes.

- **[contract item]** Each tier has a per-test time limit, and a test that breaks its tier's rules fails. The binding
  names the limits and which touch rules a tool enforces.

## What a test checks

- **[rule]** A test checks behaviour at a boundary: what a route returns, what a component renders or emits, what a
  function returns. Not how the code gets there: a refactor that keeps behaviour must not break a test.
- **[rule]** No whole-tree snapshots. Assert the specific thing.
- **[rule]** No test reads source as text. A check on source (a forbidden pattern, a design-system rule) is a lint rule.
  Config files (workflows, `checks.map.yml`, Dockerfiles) are checked by tests that parse them, not by matching their
  text; a test that runs a step's extracted shell is a behaviour test.
- **[rule]** Every test asserts an outcome (a return value, rendered text, an emitted event). A test that only runs
  code is rejected.
- **[rule]** Expected values come from the spec or the issue, never from calling the code under test.

## What a test may fake

- **[rule]** Nothing you own is faked at the boundary under test: real route code, a real database.
- **[rule]** Fakes are only for what you don't control: the network, outside services (messaging, LLM APIs), the
  clock. Each outside-service fake has a contract check: one test that the fake still has the real thing's shape.
- **[rule]** The test database is production's engine (Postgres for Postgres, SQLite for SQLite), with fresh state
  per test or per file (its own schema, a rolled-back transaction, or its own database file). The binding names the
  one provisioning mechanism for its stack.
- **[rule]** Time is never real: fake timers or an injected clock. Wait for a condition by polling it with a limit;
  never sleep.

## Retries and flaky tests

- **[contract item]** No retries in small and medium. A large test may retry once; a pass on the retry is a third
  result, "flaky", recorded, not a clean pass.
- **[rule]** A flaky test is quarantined (taken out of the suite that blocks a merge) with an issue in
  `dfox288/horizon-surveyor` and a deadline, then fixed or deleted.
- **[contract item]** The suite reports its quarantine count.

## Large tests

- **[rule]** Large tests cover only critical user journeys, a handful per app: sign-in, the app's main job, the path
  that loses data if it breaks. Edge cases go down a tier.
- **[rule]** Each large test has its own data, finds elements by role, text or test id, and fakes outside services.
- **[rule]** The app is built once per run and every large test reuses that build. Large tests run against the built
  output, never a dev server.

## Layers and the apps that use them

- **[rule]** A layer tests its own public surface in its own repo: exported composables; components' props, events
  and slots; server utilities; module options.
- **[rule]** An app doesn't re-test the layer, only its own use of it.
- **[rule]** A layer exports fakes for its apps (session, auth and the like) as a small test-utils export.
- **[rule]** A breaking layer release says so in the CHANGELOG's `Breaking` line. Each app has one smoke test that
  proves a new pin works, run at the repin. The layers' `check-consumer` gate stays; no consumer-driven contract tool.

## Tests written for a change

- **[rule]** For a bug fix or a behaviour change, the new test is run against the old code and the red run is
  recorded with its failure text. The failure is an assertion, not an import or missing-symbol error.
- **[rule]** Adding tests is free. Changing or removing an existing assertion is named in the report, with the
  reason.
- **[rule]** A test is deleted, merged into another or moved to another tier only when the spec names it, one
  commit each.

## Protected tests and the count guard

- **[contract item]** A protected test carries the stack's machine-readable `protected` marker (the binding names it).
  The overseer approves every change to a protected test. A change that removes or weakens protection (untag, delete,
  meaning change, timing) also needs an independent check by a reviewer who did not draft it, against the bar below,
  with evidence: no incident cite, not a safety or data guard, and the break-it still red. The item names each
  removal. The protected count drops only through items that name each removal.
- **[rule]** A test earns `protected` only as a safety guard (the fence, secrets, data loss) or as the test for a real
  incident or decision. It carries a plain sentence saying what it guards, plus `owner/repo#N` when an incident is
  behind it. No D-numbers, audit sections or other internal references in test code: nobody outside can resolve
  them.
- **[contract item]** Every run states the test files and tests it ran. The gate fails a tier that ran zero tests or
  fewer than its floor. The gate raises the floor; nobody raises it by hand. A change whose spec names tests to delete,
  merge or move to another tier lowers that tier's floor by exactly that many, in the same commit, and its report states
  the old and new floor.
