"""The pytest plugin of the testing baseline (bindings/python.md, "The preset sets").

Tiers are markers: unmarked is small, `medium`, `large`. Also `protected` and `quarantine`.
"""

import os
import time
from collections.abc import Iterator

import pytest
import pytest_socket

from . import LIMITS, guards
from .db import DATABASE_ENV
from .summary import Summary, tier_of

MARKERS = {
    "medium": "touches a database, files outside tmp_path or a subprocess (tier medium, 15 s)",
    "large": "runs several processes or a built app (tier large, 30 s)",
    "protected": "changed or deleted only with an explicit go; the docstring says what it guards",
    "quarantine": "flaky, out of the suite that blocks a merge: skipped and counted until fixed or deleted",
}
LOOPBACK = ["127.0.0.1", "::1", "localhost"]

_summary = Summary()
# nodeid -> (tier, quarantined), from the markers at collection: a directory called `large` makes nothing large.
_tiers: dict[str, tuple[str, bool]] = {}


def pytest_configure(config: pytest.Config) -> None:
    for name, description in MARKERS.items():
        config.addinivalue_line("markers", f"{name}: {description}")
    # An unknown marker is an error (`--strict-markers`). pytest 9 reads it through `getini`, and a plugin
    # has no public way to switch an ini option on, so the cache is set; the break-it for an unknown
    # marker proves it still works. The importlib mode is pytest's documented layout.
    config._inicache["strict_markers"] = True  # noqa: SLF001
    config.option.importmode = "importlib"
    # pytest-socket: a Unix socket is local IPC, not network (asyncio needs one for its own loop).
    config.option.allow_unix_socket = True
    if config.pluginmanager.hasplugin("rerunfailures") or config.pluginmanager.hasplugin("flaky"):
        raise pytest.UsageError("the testing baseline has no retries in pytest: remove the rerun plugin")
    os.environ["TZ"] = "UTC"
    time.tzset()
    guards.install()


def _markers(item: pytest.Item) -> set[str]:
    return {m.name for m in item.iter_markers()}


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for item in items:
        marks = _markers(item)
        _tiers[item.nodeid] = (tier_of(marks), "quarantine" in marks)
        if "timeout" in marks:
            raise pytest.UsageError(
                f"{item.nodeid} sets its own timeout; the limit is fixed by the tier "
                f"(small {LIMITS['small']} s, medium {LIMITS['medium']} s, large {LIMITS['large']} s)"
            )
        item.add_marker(pytest.mark.timeout(LIMITS[tier_of(marks)]))
        if "quarantine" in marks:
            item.add_marker(pytest.mark.skip(reason="quarantined: out of the suite that blocks a merge"))


def _database_host() -> str | None:
    from urllib.parse import urlsplit

    try:
        return urlsplit(os.environ.get(DATABASE_ENV, "")).hostname
    except ValueError:
        return None


@pytest.hookimpl(wrapper=True)
def pytest_runtest_protocol(item: pytest.Item, nextitem: pytest.Item | None) -> Iterator[None]:
    """Around setup, call and teardown of one test: sockets and the database variable by tier."""
    tier = tier_of(_markers(item))
    real_url = os.environ.get(DATABASE_ENV)
    if tier == "small":
        pytest_socket.disable_socket(allow_unix_socket=True)
        os.environ[DATABASE_ENV] = ""
    elif tier == "medium":
        hosts = LOOPBACK + ([h] if (h := _database_host()) else [])
        pytest_socket.socket_allow_hosts(hosts, allow_unix_socket=True)
    try:
        return (yield)
    finally:
        pytest_socket.enable_socket()
        if real_url is None:
            os.environ.pop(DATABASE_ENV, None)
        else:
            os.environ[DATABASE_ENV] = real_url


@pytest.hookimpl(wrapper=True)
def pytest_runtest_call(item: pytest.Item) -> Iterator[None]:
    """The write guard, around the test body of a small test."""
    if tier_of(_markers(item)) != "small":
        return (yield)
    tmp_path = getattr(item, "funcargs", {}).get("tmp_path")
    guards.begin([tmp_path] if tmp_path else [])
    try:
        result = yield
    except BaseException:
        guards.end()
        raise
    violations = guards.end()
    if violations:
        # Raised inside the test and swallowed (`except Exception`) is still a failure.
        pytest.fail("; ".join(dict.fromkeys(violations)), pytrace=False)
    return result


@pytest.hookimpl(trylast=True)
def pytest_exception_interact(node: pytest.Item, call: pytest.CallInfo) -> None:
    """pytest-timeout stops its timer when a test fails (it assumes a debugger). Teardown after a failure
    (a fixture that waits on a lock the failed test still holds) must stay under the limit too, so the
    timer is armed again, for a fresh limit."""
    if call.when == "teardown" or node.config.getoption("usepdb", False):
        return
    try:
        from pytest_timeout import _get_item_settings
    except ImportError:  # pragma: no cover - a pytest-timeout without it: the pinned version has it
        return
    settings = _get_item_settings(node)
    if settings.timeout:
        node.config.pluginmanager.hook.pytest_timeout_set_timer(item=node, settings=settings)


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    tier, quarantined = _tiers.get(report.nodeid, ("small", False))
    if report.when == "call" or (report.when == "setup" and report.outcome in ("failed", "skipped")):
        if report.skipped:
            _summary.skipped += 1
            if quarantined:
                _summary.quarantined += 1
            return
        _summary.add_ran(report.nodeid, tier, report.failed)
    elif report.when == "teardown" and report.failed:
        _summary.failed += 1


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    terminalreporter.write_line(_summary.line())


def pytest_sessionfinish(session: pytest.Session) -> None:
    _summary.write()
