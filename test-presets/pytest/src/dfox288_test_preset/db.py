"""The DB helper (bindings/python.md, "Databases"): one schema per test or file in the server the
environment provides as TEST_DATABASE_URL, dropped afterwards. No container is started here.

`open_test_schema` has no driver of its own: the repo passes `connect`, a function from URL to a DB-API
connection. In a small test the variable is empty, so everything here raises: mark the test `medium`.

    @pytest.fixture
    def schema():
        with open_test_schema(my_driver.connect) as s:   # a fixture's scope is the schema's scope
            yield s

Under xdist the plugin gives each worker a database of its own on that server and points TEST_DATABASE_URL at
it (README, "Parallel runs"). It does that with the preset's own driver (pg8000), for `CREATE DATABASE` and
`DROP DATABASE` only, in a child process: the functions at the end of this file. The preset never imports its own
dependencies into the process under test; a repo may vendor its own driver. A test reads the variable when it runs,
never at import, because its value differs per worker.
"""

import json
import os
import secrets
import subprocess
import sys
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote, urlsplit, urlunsplit

from .admin import ADMIN_URL_ENV, identifier

DATABASE_ENV = "TEST_DATABASE_URL"
# `<prefix>_<run>_<worker>`: the databases the plugin makes for the workers of one run.
WORKER_DATABASE_PREFIX = "dfox288_worker"
# A `DROP DATABASE` waits for a checkpoint (4 to 11 s on a slow disk, bindings/python.md); the child's connect has its own 10 s.
CHILD_TIMEOUT = 60


class DatabaseNotAllowed(RuntimeError):
    pass


def test_database_url() -> str:
    url = os.environ.get(DATABASE_ENV, "").strip()
    if not url:
        raise DatabaseNotAllowed(
            f"{DATABASE_ENV} is empty: only a test marked medium (or large) may use the database"
        )
    return url


test_database_url.__test__ = False  # type: ignore[attr-defined]  # not a test, whatever pytest thinks of the name


@dataclass
class TestSchema:
    __test__ = False

    url: str
    name: str
    connect: Callable[[str], Any]

    def connection(self) -> Any:
        """A new connection with `search_path` pinned to the schema. The caller closes it."""
        conn = self.connect(self.url)
        cur = conn.cursor()
        cur.execute(f'SET search_path TO "{self.name}"')
        conn.commit()
        return conn


@contextmanager
def open_test_schema(connect: Callable[[str], Any], prefix: str = "t") -> Iterator[TestSchema]:
    url = test_database_url()
    name = f"{prefix}_{os.getpid()}_{secrets.token_hex(4)}"
    admin = connect(url)
    try:
        cur = admin.cursor()
        cur.execute(f'CREATE SCHEMA "{name}"')
        admin.commit()
        try:
            yield TestSchema(url=url, name=name, connect=connect)
        finally:
            cur = admin.cursor()
            cur.execute(f'DROP SCHEMA IF EXISTS "{name}" CASCADE')
            admin.commit()
    finally:
        admin.close()


def database_url(url: str, database: str) -> str:
    """`url` with its database replaced by `database`."""
    return urlunsplit(urlsplit(url)._replace(path="/" + database))


class DatabaseAdminError(RuntimeError):
    """A statement the child process ran failed. The message names the error, never the URL."""


def _run_admin(url: str, command: str, argument: str) -> list[str]:
    """Runs one statement of `admin.py` in a child process and returns the names it answers with. The preset never
    imports its own dependencies (pg8000 and what it needs) into the process under test: a repo may vendor its own.
    The URL goes by environment, not on the command line, and is taken out of whatever the child says."""
    # `-I`: the child reads no PYTHON* variable and not the working directory, where a repo's module could shadow the driver
    argv = [sys.executable, "-I", "-m", "dfox288_test_preset.admin", command, argument]
    try:
        done = subprocess.run(
            argv,
            env={**os.environ, ADMIN_URL_ENV: url},
            capture_output=True,
            text=True,
            timeout=CHILD_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise DatabaseAdminError(f"TimeoutExpired: {command} {argument} took more than {CHILD_TIMEOUT} s") from None
    if done.returncode != 0:
        say = done.stderr.strip().splitlines()[-1:] or [f"exit status {done.returncode}"]
        message = say[0]
        for secret in (url, unquote(urlsplit(url).password or "")):
            if secret:
                message = message.replace(secret, "***")
        raise DatabaseAdminError(message)
    return json.loads(done.stdout.strip().splitlines()[-1])


def admin_connect(url: str) -> Any:
    """A pg8000 connection in autocommit on `url`'s database, for statements a transaction cannot hold.

    Unlike everything else here this imports the driver into the calling process: the preset's own tests use it. The
    plugin does not, and a repo's tests that vendor their own driver should not."""
    from .admin import connect

    return connect(url)


def create_database(url: str, name: str) -> str:
    """Creates the empty database `name` (from `template0`) on the server `url` names; returns the URL that reaches it."""
    identifier(name)
    _run_admin(url, "create", name)
    return database_url(url, name)


def drop_database(url: str, name: str) -> None:
    """Drops `name` on the server `url` names, kicking out whoever is still connected."""
    identifier(name)
    _run_admin(url, "drop", name)


def drop_databases_starting_with(url: str, prefix: str) -> list[str]:
    """Drops every database whose name starts with `prefix` (a plain name part); returns their names."""
    identifier(prefix)
    return _run_admin(url, "drop-starting-with", prefix)
