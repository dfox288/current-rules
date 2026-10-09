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
`DROP DATABASE` only: the functions at the end of this file. A test reads the variable when it runs, never at
import, because its value differs per worker.
"""

import os
import re
import secrets
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote, urlsplit, urlunsplit

DATABASE_ENV = "TEST_DATABASE_URL"
# `<prefix>_<run>_<worker>`: the databases the plugin makes for the workers of one run.
WORKER_DATABASE_PREFIX = "dfox288_worker"


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


def _identifier(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]{1,63}", name):
        raise ValueError(f"not a plain database name: {name!r}")
    return f'"{name}"'


def admin_connect(url: str) -> Any:
    """A pg8000 connection in autocommit on `url`'s database, for statements a transaction cannot hold."""
    import pg8000.dbapi

    try:
        parts = urlsplit(url)
        port = parts.port or 5432
    except ValueError:
        parts, port = None, None
    if not port or parts.scheme not in ("postgres", "postgresql") or not parts.hostname or not parts.username:
        # never the URL itself: it carries the password
        raise ValueError(f"{DATABASE_ENV} is not a postgres://user:password@host:port/db URL")
    conn = pg8000.dbapi.connect(
        user=unquote(parts.username),
        password=unquote(parts.password or ""),
        host=parts.hostname,
        port=port,
        database=unquote(parts.path.lstrip("/")) or "postgres",
        timeout=10,
    )
    conn.autocommit = True
    return conn


def create_database(url: str, name: str) -> str:
    """Creates the empty database `name` (from `template0`) on the server `url` names; returns the URL that reaches it."""
    identifier = _identifier(name)
    admin = admin_connect(url)
    try:
        admin.cursor().execute(f"CREATE DATABASE {identifier} TEMPLATE template0")
    finally:
        admin.close()
    return database_url(url, name)


def drop_database(url: str, name: str) -> None:
    """Drops `name` on the server `url` names, kicking out whoever is still connected."""
    identifier = _identifier(name)
    admin = admin_connect(url)
    try:
        admin.cursor().execute(f"DROP DATABASE IF EXISTS {identifier} WITH (FORCE)")
    finally:
        admin.close()


def drop_databases_starting_with(url: str, prefix: str) -> list[str]:
    """Drops every database whose name starts with `prefix` (a plain name part); returns their names."""
    _identifier(prefix)
    admin = admin_connect(url)
    try:
        cur = admin.cursor()
        cur.execute(
            "SELECT datname FROM pg_database WHERE starts_with(datname, %s) ORDER BY datname", (prefix,)
        )
        names = [row[0] for row in cur.fetchall()]
        for name in names:
            cur.execute(f"DROP DATABASE IF EXISTS {_identifier(name)} WITH (FORCE)")
        return names
    finally:
        admin.close()
