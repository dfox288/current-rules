# Binding: Python

How a repo's Python code meets `testing.md`. Where pytest or Python documents a scheme, this file follows it (D-358).
Production code stays free of dependencies unless that would mean building our own version of an existing tool.

## Version and tools

- **[contract item]** Python 3.14, pinned in `.python-version`, for tests and production alike. Production runs on it
  through `uv` (`uv run`), never on the operating system's Python.
- **[contract item]** Test-only dependencies are a PEP 735 dependency group in `pyproject.toml`
  (`[dependency-groups] test = [...]`), installed by `uv` with `uv.lock` committed. Production declares no
  dependencies.
- **[rule]** Format and lint are `ruff`, pinned by the pytest preset (a repo adds no ruff of its own). There is no
  Python typecheck. The commit hook (`dfox288-pre-commit`, shipped with the preset) runs `ruff format` and `ruff check`
  on the staged `.py` files with the preset's settings; the repo's `[tool.ruff]` in `pyproject.toml` (or `ruff.toml`)
  overrides single keys.

## Layout and names

*(The contract items here are checked by the conformance script, not built yet: horizon-surveyor#70; until then the
reviewer checks them.)*

- **[contract item]** pytest's documented layout: the code in `src/<package>/`, tests in `tests/`, configuration in
  `pyproject.toml` (`[tool.pytest]`), `--import-mode=importlib`.
- **[contract item]** Tiers are pytest markers: an unmarked test is small; `@pytest.mark.medium` marks a test that
  touches a database, files outside its own temp dir, or a subprocess; `@pytest.mark.large` marks one that runs several
  processes or a built app. `--strict-markers` makes an unknown marker an error.
- **[contract item]** `@pytest.mark.quarantine` marks a flaky test: it is skipped and counted in the run line and the
  gate's summary.
- **[contract item]** A protected test carries `@pytest.mark.protected`, with the sentence on what it guards (and
  `owner/repo#N` when an incident is behind it) in its docstring.
- **[rule]** Tests run through pytest: `uv run --group test pytest <file>` for a focused run. Existing `unittest`
  classes run under pytest unchanged. Only the gate script runs a whole tier (it selects with `-m`).

## The preset

Each repo installs the pytest preset and the shared gate script from the public preset repo, as a git dependency
pinned to a tag. Until a repo has migrated, its own scripts and README apply. Install syntax and the options are in
`test-presets/README.md`.

The preset sets:

- **Time limits per test** (`pytest-timeout`): small 5 s, `medium` 15 s, `large` 30 s.
- **Retries:** none; no rerun plugin (a rerun plugin in the environment is a usage error).
- **`TZ=UTC`.**
- **Small's guards:** sockets are blocked (`pytest-socket`); a write outside its own temp dir (`tmp_path`, or one it created through `tempfile`) fails it;
  `TEST_DATABASE_URL` is empty unless the test is marked `medium` or `large`, so the DB helper raises. Sleep and process starts
  are not guarded; the reviewer checks them.
- **The count guard:** every run states the files and tests it ran; a tier below its floor fails. It is the same under
  xdist: the controller counts, and only it writes the summary.
- **The commit hook** (`dfox288-pre-commit`; `test-presets/README.md`, "Commit hooks"): `ruff format` and `ruff check` on the
  staged `.py` files, offline, never a test, no type checker. A repo wires it as a one-line `.githooks/pre-commit`
  (`exec uv run --no-sync --group test dfox288-pre-commit`).
- **Parallel runs** (`pytest-xdist`): a run with no `-n` is `-n auto --dist=worksteal`, 4 to 6 workers; `-n0` runs in one
  process. With `TEST_DATABASE_URL` set, each worker has a database of its own and the variable points at it.

## Databases

- **[rule]** A server database (today: Postgres) comes from the environment as `TEST_DATABASE_URL`, on the engine
  production uses; tests never start a container. The preset's DB helper gives each test or file its own schema or
  database and drops it afterwards. An app that ships an in-process database (SQLite) tests on it directly: in memory
  or a file per test file.
- **[rule]** A database test reads `TEST_DATABASE_URL` when it runs, never at import and never as a hard-coded name:
  under xdist its value differs per worker, and a copy taken at import points every worker at the same database.
- **[rule]** A schema per test, not a database per test. Dropping a database makes the server checkpoint at once: 4 to 11 s
  each with 6 to 8 workers on a slow disk, against a 15 s medium limit. A test that needs its own database (a role, an
  extension) says why in its docstring.

## Parallel runs

The preset runs the tests in parallel (above), so a test shares nothing it does not own. `testing.md` ("What a test may
fake") has the rules for ports and server-wide names.

- **[rule]** A file a test writes goes under `tmp_path` or `tempfile`, never a fixed path in the repo or the system temp
  directory. Two workers writing the same path collide.
- **[rule]** A collision under parallel is fixed in the test, not hidden by running the suite in one process. A suite
  that does not pass with the preset's default `-n` is not done: a repo does not add `-n0` to `addopts`.
