# The selection file

Which check kinds a change runs, and how much of each: the format of `checks.map.yml` in a repo's root, version 2. For
the system (Current's gate, a repo's CI), not part of a worker's prompt; `testing.md` says what a worker does with it.
When each stage runs the selection is in `testing-system.md`.

The selection is a pure function of two things: this file as it is on the base, and the list of files the change
touches (`base..tip`). No stored state, no coverage database. Where it is wrong, the full run after the merge finds it.

## Keys

| Key | What it holds |
|---|---|
| `version` | `2`. |
| `always` | Kinds that run whole with every change, unless every changed file is `untested`. |
| `untested` | Globs of files no test reads (docs, spikes). They bring in no kind and not `always`; a kind whose own globs match them still runs (docs and `format`). |
| `kinds.<name>.paths` | Globs of the files that concern the kind. Any match, no order. |
| `kinds.<name>.tests` | Globs of the kind's test files, by the stack's naming scheme (never a list of file names). A kind with `tests` takes test paths. |
| `kinds.<name>.narrow` | The toolchain's import-graph step for this kind (table below). Unset: the kind runs whole. |
| `kinds.<name>.triggers` | Globs that run the kind whole although it narrows: what its import graph can't see (configs, lockfile, fixtures, i18n, scripts, the test support files). Only on a kind with `narrow`. |
| `kinds.<name>.edges` | The hand list: `{ paths, tests }` pairs for a file no import shows (a data file a test loads, a script it spawns), and the tests that read it. Only on a kind with `narrow`. |

Every kind is in `always` or has `paths`. A kind's name is the gate kind's name in Current's config and the repo's CI.
Paths use gitignore syntax (as the fence does). The kinds' environment (image, services, tools, env, `describe`) is not
selection: it is in `checks.kinds.yml` beside this file, which is fenced (`testing-system.md`); this file is not.

## Reading rules

For each kind, the first of rules 1 to 7 that applies decides; rule 8 comes after.

1. **Everything.** A change to this file, or a changed file that nothing matches (no kind's `paths`, `tests`,
   `triggers` or `edges` paths, not `untested`), runs every kind whole.
2. **Always.** A kind in `always` runs whole when some changed file is not `untested`.
3. **The kind's files** are the changed files any of its four lists matches. None: the kind is skipped.
4. **Trigger.** One of its files matches its `triggers`: the kind runs whole.
5. **Test files only.** Every one of its files is a test file of the kind (`tests`) that still exists: the kind runs
   those test files and nothing else. A changed test file always runs.
6. **Narrowed.** The kind has `narrow`: it runs the toolchain's selection over its changed files, plus the `tests` of
   every edge whose `paths` match a changed file, plus its changed test files. A selection of zero tests skips the
   kind and says so.
7. **Whole.** Otherwise the kind runs whole. A kind that is slow is made fast (parallel workers, a template database,
   a split project), not selected. Fast is whole in 60 s or less in Current's container, measured by the bench
   report, not gated.
8. **The spec adds.** Current adds the kinds the spec names, whole. It can only add.

Each decision carries its reason (the rule and the file), and the gate records it beside the result: that record is
what turns a red full run after the merge into a counted miss (`testing-system.md`).

## Narrowing steps per toolchain

| Toolchain | `narrow` | Step |
|---|---|---|
| Vitest | `vitest-related` | `vitest related --run <files>`: the tests that import the changed files, statically. |
| Playwright (e2e) | none | `--only-changed` sees no app code from an e2e test: e2e runs by kind. |
| pytest | none | testmon needs a stored coverage database (not deterministic): `python` runs whole, made fast. |

A toolchain's step is added here when it has an import graph that reads the tree alone. It sits on top of rules 1 to
5; it is never the base.

## Checks of the file

A file that is missing or invalid on the base runs everything. The shape test (from the presets; until then the
repo's own) is red when: a key is unknown; a kind is missing from `checks.kinds.yml`; an `always` entry is not a kind;
a kind has neither `always` nor `paths`; a glob matches no tracked file; a glob is a catch-all (`*`, `**`: a file
nothing matches already runs everything); an edge's `tests` are not the kind's test files; `triggers` or `edges` sit
on a kind without `narrow`; `narrow` names a step not in the table above.

## Example (Python and Nuxt)

```yaml
# checks.map.yml: which kinds a change runs (current-rules selection.md). The kinds' environment: checks.kinds.yml.
version: 2
always: [lint, format, typecheck]
untested: ['*.md', 'docs/**', 'spikes/**', '.git-blame-ignore-revs']
kinds:
  format: { paths: ['*.md', 'docs/**'] }       # Prettier reads Markdown: a docs change runs format, nothing else
  python:
    paths: [src/**, tests/**, bin/**, launchd/**, scripts/**, docker/**, Dockerfile, .github/**, pyproject.toml, uv.lock, /test-floors.json]
    tests: ['tests/**/test_*.py']
  test:
    paths: [web/**]
    tests: ['web/test/unit/**/*.test.ts', 'web/test/nuxt/**/*.test.ts']
    narrow: vitest-related
    triggers: [web/package.json, web/pnpm-lock.yaml, web/nuxt.config.ts, web/tsconfig.json, web/test-floors.json,
               web/test/support.ts, web/test/realms.setup.ts, web/test/fixtures/**, web/i18n/**, web/scripts/**]
    edges:
      # load src/lookout/worker/login_fields.json and tests/fixtures/*.json; spawn tests/web_ingest_db.py
      - paths: [src/lookout/worker/**, tests/web_ingest_db.py, tests/fixtures/*.json]
        tests: [web/test/unit/ingest.test.ts, web/test/unit/ingestDb.test.ts, web/test/unit/ingest.db.test.ts]
      # read app sources as text; gone once they are lint rules (testing.md)
      - paths: [web/app/**]
        tests: [web/test/unit/designSystem*.test.ts, web/test/unit/lookoutCss.test.ts, web/test/unit/key*.test.ts]
  e2e:
    paths: [web/app/**, web/server/**, web/shared/**, web/i18n/**, web/test/e2e/**, web/test/fixtures/**,
            web/package.json, web/pnpm-lock.yaml, web/nuxt.config.ts, web/test-floors.json]
    tests: ['web/test/e2e/**/*.e2e.test.ts']
  build: { paths: [web/app/**, web/server/**, web/shared/**, web/i18n/**, web/package.json, web/pnpm-lock.yaml, web/nuxt.config.ts] }
```

A change to `web/app/utils/filter.ts` runs `lint`, `format`, `typecheck` whole, `test` narrowed to the tests that
import it and the edge's tests that read `web/app/` as text, `e2e` and `build` whole, and skips `python`. A change to `tests/test_status.py` alone runs that file in
`python` and the three `always` kinds. A change to `web/pnpm-lock.yaml` runs `test`, `e2e`, `build` and the `always`
kinds whole. A change to `README.md` runs `format`.

## From version 1

| Version 1 | Version 2 |
|---|---|
| `kinds` (image, services, localhostNames, dir, env, tools, describe, cache) | `checks.kinds.yml`, unchanged |
| `kinds.<name>.paths: true` | implied by `tests` |
| `gateStatuses`, `floors` | `checks.kinds.yml`, unchanged: what Current and CI do for the repo, not selection |
| `always` | stays |
| `rules` (ordered, first match wins) | `kinds.<name>.paths`, any match, no order |
| `rules` entries with `run: []` or `run: [format]` | `untested`, plus `format`'s own `paths` |
| `sections` that list test files by name (`web-unit`, the `e2e-*` sections, `py-*`) | gone: `tests` globs, the import graph, or the kind whole |
| `sections` for tests that read what no import shows (`web-ingest`) | `edges` |
| `sections` for tests that read source as text (`web-scans`) | `edges` until they are lint rules (`testing.md`), then gone |
| a kind name in `run` (the whole kind) | the kind's `paths`, or its `triggers` where it narrows |
| a changed test file runs its section | rule 5 |
| unmatched file runs everything; a change to the file runs everything | rule 1, unchanged |
| the spec names a kind or a section | the spec names a kind (rule 8) |
| Current's `narrowGates` per repo | `narrow` per kind, in the file |
