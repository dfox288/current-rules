"""Small's guards: writes outside the test's temp dirs, and the database.

Sockets are `pytest-socket`'s (see plugin.py). The write guard is a Python audit hook: it sees every
`open`, `os.mkdir`, `shutil.copyfile`, ... including the ones made in C, and it is active only while a
small test runs. Allowed roots for a small test: its `tmp_path`, and whatever the test itself created
through `tempfile` (mkdtemp, TemporaryDirectory, NamedTemporaryFile, mkstemp). Python's own bytecode
cache (`__pycache__/*.pyc`) is always allowed: a lazy import must not fail.
"""

import os
import sqlite3
import sys
import tempfile
import threading
from collections.abc import Iterable
from pathlib import Path

# audit event -> ((index of a path argument being written, index of its dir_fd argument or None), ...)
WRITE_EVENTS: dict[str, tuple[tuple[int, int | None], ...]] = {
    "os.mkdir": ((0, 2),),
    "os.remove": ((0, 1),),
    "os.rmdir": ((0, 1),),
    "os.rename": ((0, 2), (1, 3)),
    "os.truncate": ((0, None),),
    "os.chmod": ((0, 2),),
    "os.chown": ((0, 3),),
    "os.utime": ((0, 3),),
    "os.link": ((1, 3),),
    "os.symlink": ((1, 2),),
    "os.mkfifo": ((0, 2),),
    "shutil.copyfile": ((1, None),),
    "shutil.copytree": ((1, None),),
    "shutil.move": ((1, None),),
    "shutil.rmtree": ((0, 1),),
}

_WRITE_FLAGS = os.O_WRONLY | os.O_RDWR | os.O_CREAT | os.O_TRUNC | os.O_APPEND


class SmallTierViolation(Exception):
    """Raised inside a small test that touches what its tier forbids. Not an OSError: code under test
    that catches OSError must not swallow it. The plugin fails the test for it even if it is swallowed."""


class _State(threading.local):
    active = False
    allowed: list[str]
    violations: list[str]
    in_tempfile = 0

    def __init__(self) -> None:
        self.allowed = []
        self.violations = []


state = _State()
_installed = False


def _path_of_fd(fd: int) -> str | None:
    """The directory a dir_fd points at (Linux: /proc, macOS: F_GETPATH); None when it can't be told."""
    try:
        return os.readlink(f"/proc/self/fd/{fd}")
    except OSError:
        pass
    try:
        import fcntl

        raw = fcntl.fcntl(fd, fcntl.F_GETPATH, b"\0" * 1024)  # type: ignore[attr-defined]
        return os.fsdecode(raw.split(b"\0", 1)[0])
    except (ImportError, AttributeError, OSError):
        return None


def _resolve(path: object, dir_fd: object = None) -> str | None:
    if isinstance(path, int):
        return None  # a file descriptor: checked when it was opened
    try:
        text = os.fsdecode(path)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None
    if isinstance(dir_fd, int) and dir_fd >= 0 and not os.path.isabs(text):
        base = _path_of_fd(dir_fd)
        if base is None:
            return None  # relative to a directory we can't locate: not judged
        text = os.path.join(base, text)
    return os.path.realpath(text)


def _inside(path: str) -> bool:
    if path == os.devnull or (path.endswith(".pyc") and f"{os.sep}__pycache__{os.sep}" in path):
        return True
    return any(path == root or path.startswith(root + os.sep) for root in state.allowed)


def _check(event: str, path: object, dir_fd: object = None) -> None:
    resolved = _resolve(path, dir_fd)
    if resolved is None or _inside(resolved):
        return
    if state.in_tempfile and resolved.startswith(os.path.realpath(tempfile.gettempdir()) + os.sep):
        return  # tempfile creating its own entry: allowed, and remembered by the wrapper
    message = (
        f"tests of the small tier write only inside their tmp_path or a tempfile they made "
        f"({event} {resolved}); use tmp_path or mark the test medium"
    )
    state.violations.append(message)
    raise SmallTierViolation(message)


def _hook(event: str, args: tuple) -> None:
    if not state.active:
        return
    if event == "open":
        path, _mode, flags = args
        if isinstance(flags, int) and flags & _WRITE_FLAGS:
            _check("open", path)
    elif event in WRITE_EVENTS:
        for index, fd_index in WRITE_EVENTS[event]:
            if index < len(args):
                dir_fd = args[fd_index] if fd_index is not None and fd_index < len(args) else None
                _check(event, args[index], dir_fd)
    elif event == "sqlite3.connect":
        database = args[0]
        if database not in (":memory:", "") and not str(database).startswith("file::memory:"):
            _check("sqlite3.connect", database)


def _remember(path: str) -> None:
    resolved = os.path.realpath(path)
    if resolved not in state.allowed:
        state.allowed.append(resolved)


def _wrap_tempfile() -> None:
    """Paths a test makes through tempfile are its own temp dirs for the rest of the test."""
    real_mkdtemp = tempfile.mkdtemp
    real_inner = tempfile._mkstemp_inner  # type: ignore[attr-defined]

    def mkdtemp(*args, **kwargs):  # noqa: ANN002, ANN003
        state.in_tempfile += 1
        try:
            path = real_mkdtemp(*args, **kwargs)
        finally:
            state.in_tempfile -= 1
        if state.active:
            _remember(path)
        return path

    def mkstemp_inner(*args, **kwargs):  # noqa: ANN002, ANN003
        state.in_tempfile += 1
        try:
            fd, path = real_inner(*args, **kwargs)
        finally:
            state.in_tempfile -= 1
        if state.active:
            _remember(path)
        return fd, path

    tempfile.mkdtemp = mkdtemp
    tempfile._mkstemp_inner = mkstemp_inner  # type: ignore[attr-defined]


def install() -> None:
    global _installed
    if _installed:
        return
    _installed = True
    sys.addaudithook(_hook)
    _wrap_tempfile()
    assert sqlite3  # imported so the `sqlite3.connect` event exists in builds that load it lazily


def begin(allowed: Iterable[Path | str]) -> None:
    state.allowed = [os.path.realpath(p) for p in allowed]
    state.violations = []
    state.active = True


def end() -> list[str]:
    state.active = False
    violations, state.violations, state.allowed = state.violations, [], []
    return violations
