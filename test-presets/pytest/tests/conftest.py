"""Helpers for the tests that run pytest itself (a small suite under a temp dir, in a subprocess: xdist starts
workers, and a plugin's `-n` handling is read before any test runs)."""

import json
import os
from dataclasses import dataclass
from pathlib import Path

import pytest
from dfox288_test_preset.admin import connect as admin_connect
from dfox288_test_preset.db import DATABASE_ENV

pytest_plugins = ["pytester"]

# Written into the inner suite: what each process saw, for the outer test to read.
INNER_CONFTEST = '''
import os

from dfox288_test_preset import summary

SEEN = os.path.join(os.environ["INNER_DIR"], "seen.txt")


def _note(line):
    with open(SEEN, "a") as f:
        f.write(line + "\\n")


def pytest_report_header(config):
    return "inner: numprocesses=%s dist=%s" % (getattr(config.option, "numprocesses", "-"), getattr(config.option, "dist", "-"))


def pytest_sessionstart(session):
    _note("START %s %s" % (os.environ.get("PYTEST_XDIST_WORKER", "main"), os.environ.get("PYTEST_XDIST_TESTRUNUID", "-")))


def pytest_runtest_setup(item):
    # not logstart: under xdist the controller replays that one
    _note("TEST %s %s" % (os.environ.get("PYTEST_XDIST_WORKER", "main"), item.nodeid))


_write = summary.Summary.write


def _logged_write(self):
    _note("WRITE %s" % os.environ.get("PYTEST_XDIST_WORKER", "main"))
    _write(self)


summary.Summary.write = _logged_write
'''


@dataclass
class Inner:
    result: pytest.RunResult
    dir: Path

    @property
    def lines(self) -> list[list[str]]:
        seen = self.dir / "seen.txt"
        return [line.split() for line in seen.read_text().splitlines()] if seen.exists() else []

    def workers_that_ran_tests(self) -> set[str]:
        return {line[1] for line in self.lines if line[0] == "TEST"}

    def run_ids(self) -> set[str]:
        return {line[2] for line in self.lines if line[0] == "START" and line[2] != "-"}

    def summary(self) -> dict:
        return json.loads((self.dir / "summary.json").read_text())

    def output(self) -> str:
        return self.result.stdout.str() + self.result.stderr.str()


@pytest.fixture
def run_inner(pytester, monkeypatch):
    """`run_inner(*args, files={...}, env={...}, conftest="...")`: pytest in a subprocess on a suite made of `files` (name -> source),
    with the preset loaded as it is for any repo; `conftest` is added to the suite's conftest. The environment is the outer test's, minus what makes the outer
    an xdist worker, plus `env`."""
    for key in [k for k in os.environ if k.startswith("PYTEST_XDIST")]:
        monkeypatch.delenv(key)
    monkeypatch.setenv("INNER_DIR", str(pytester.path))
    monkeypatch.setenv("TEST_PRESET_SUMMARY", str(pytester.path / "summary.json"))

    def run(
        *args: str, files: dict[str, str], env: dict[str, str | None] | None = None, conftest: str = ""
    ) -> Inner:
        pytester.makeconftest(INNER_CONFTEST + conftest)
        for name, source in files.items():
            path = pytester.path / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source)
        with monkeypatch.context() as run_env:  # `env` holds for this run only
            for key, value in (env or {}).items():
                run_env.delenv(key, raising=False) if value is None else run_env.setenv(key, value)
            result = pytester.runpytest_subprocess("-p", "no:cacheprovider", *args)
        return Inner(result, pytester.path)

    return run


@pytest.fixture
def worker_databases():
    """`worker_databases(run_id)`: the databases on the server the environment provides that belong to the run `run_id`
    (the preset's names), as a sorted list."""

    def find(run_id: str) -> list[str]:
        conn = admin_connect(os.environ[DATABASE_ENV])
        try:
            cur = conn.cursor()
            cur.execute(
                "SELECT datname FROM pg_database WHERE starts_with(datname, %s)", (f"dfox288_worker_{run_id[:12]}_",)
            )
            return sorted(row[0] for row in cur.fetchall())
        finally:
            conn.close()

    return find
