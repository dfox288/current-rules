"""The server-side statements the preset runs with its own driver (pg8000), in a process of their own.

    python -I -m dfox288_test_preset.admin create <name>
    python -I -m dfox288_test_preset.admin drop <name>
    python -I -m dfox288_test_preset.admin drop-starting-with <prefix>

The server URL is in the environment (`ADMIN_URL_ENV`), never on the command line: it carries the password. The answer is
one JSON line on stdout (the names a sweep dropped); a failure is `ErrorType: message` on stderr and exit status 1.

The preset never imports its own dependencies into the process under test: a repo may vendor its own pg8000 and test
that it loads from there. `db.py` starts this module with `subprocess` and imports only its constant and `identifier`;
the driver is imported where `connect` runs: in that child (README, "Parallel runs").
"""

import json
import os
import re
import sys
from urllib.parse import unquote, urlsplit

ADMIN_URL_ENV = "DFOX288_TEST_PRESET_ADMIN_URL"
DATABASE_ENV = "TEST_DATABASE_URL"  # only for the message below: db.py has the same constant, and imports no driver


def identifier(name: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_]{1,63}", name):
        raise ValueError(f"not a plain database name: {name!r}")
    return f'"{name}"'


def connect(url: str):
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


def create(url: str, name: str) -> list[str]:
    ident = identifier(name)
    conn = connect(url)
    try:
        conn.cursor().execute(f"CREATE DATABASE {ident} TEMPLATE template0")
    finally:
        conn.close()
    return []


def drop(url: str, name: str) -> list[str]:
    ident = identifier(name)
    conn = connect(url)
    try:
        conn.cursor().execute(f"DROP DATABASE IF EXISTS {ident} WITH (FORCE)")
    finally:
        conn.close()
    return []


def drop_starting_with(url: str, prefix: str) -> list[str]:
    identifier(prefix)
    conn = connect(url)
    try:
        cur = conn.cursor()
        cur.execute("SELECT datname FROM pg_database WHERE starts_with(datname, %s) ORDER BY datname", (prefix,))
        names = [row[0] for row in cur.fetchall()]
        for name in names:
            cur.execute(f"DROP DATABASE IF EXISTS {identifier(name)} WITH (FORCE)")
        return names
    finally:
        conn.close()


COMMANDS = {"create": create, "drop": drop, "drop-starting-with": drop_starting_with}


def main(argv: list[str]) -> int:
    url = os.environ.get(ADMIN_URL_ENV, "")
    if len(argv) != 2 or argv[0] not in COMMANDS or not url:
        print(f"usage: {ADMIN_URL_ENV}=<url> python -m {__spec__.name} ({'|'.join(COMMANDS)}) <name>", file=sys.stderr)
        return 2
    try:
        names = COMMANDS[argv[0]](url, argv[1])
    except Exception as error:  # the parent raises it again, without the URL
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    print(json.dumps(names))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
