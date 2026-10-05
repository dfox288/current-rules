# Binding: Python

How a repo's Python code meets `testing.md`. Where pytest or Python documents a scheme, this file follows it (D-358).
Production code stays free of dependencies unless that would mean building our own version of an existing tool.

## Version and tools

- **[contract item]** Python 3.14, pinned in `.python-version`, for tests and production alike. Production runs on it
  through `uv` (`uv run`), never on the operating system's Python.
- **[contract item]** Test-only dependencies are a PEP 735 dependency group in `pyproject.toml`
  (`[dependency-groups] test = [...]`), installed by `uv` with `uv.lock` committed. Production declares no
  dependencies.

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
- **The count guard:** every run states the files and tests it ran; a tier below its floor fails.

## Databases

- **[rule]** A server database (today: Postgres) comes from the environment as `TEST_DATABASE_URL`, on the engine
  production uses; tests never start a container. The preset's DB helper gives each test or file its own schema or
  database and drops it afterwards. An app that ships an in-process database (SQLite) tests on it directly: in memory
  or a file per test file.
