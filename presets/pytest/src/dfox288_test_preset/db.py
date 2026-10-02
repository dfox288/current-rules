"""The DB helper (bindings/python.md, "Databases"): one schema per test or file in the server the
environment provides as TEST_DATABASE_URL, dropped afterwards. No container is started here.

The helper has no driver of its own (the preset's runtime dependencies are pytest, pytest-timeout and
pytest-socket): the repo passes `connect`, a function from URL to a DB-API connection. In a small test the
variable is empty, so everything here raises: mark the test `medium`.

    @pytest.fixture
    def schema():
        with open_test_schema(my_driver.connect) as s:   # a fixture's scope is the schema's scope
            yield s
"""

import os
import secrets
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Any

DATABASE_ENV = "TEST_DATABASE_URL"


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
