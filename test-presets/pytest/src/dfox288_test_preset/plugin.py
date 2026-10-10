"""The pytest plugin of the testing baseline (bindings/python.md, "The preset sets").

Tiers are markers: unmarked is small, `medium`, `large`. Also `protected` and `quarantine`.

Runs are parallel by default (pytest-xdist). Under xdist the controller counts the run (it sees every report, a
worker only its share), so each report carries its test's tier and marks from the worker that ran it; and each
worker gets a database of its own when TEST_DATABASE_URL is set.
"""

import os
import sys
import time
from collections.abc import Iterator

import pytest
import pytest_socket

from . import LIMITS, db, guards, parallel
from .db import DATABASE_ENV
from .summary import Summary, tier_of

MARKERS = {
    "medium": "touches a database, files outside tmp_path or a subprocess (tier medium, 15 s)",
    "large": "runs several processes or a built app (tier large, 30 s)",
    "protected": "the overseer approves changes; a removal or weakening needs an independent reviewer's check against the bar and is named in the item; the docstring says what it guards",
    "quarantine": "flaky, out of the suite that blocks a merge: skipped and counted until fixed or deleted",
}
LOOPBACK = ["127.0.0.1", "::1", "localhost"]

_summary = Summary()
# On a report (set by `pytest_runtest_makereport`, sent from an xdist worker to the controller): {"tier", "quarantined",
# "protected"}, from the test's markers (`iter_markers` also yields a class's and a module's marks): a directory
# called `large` makes nothing large.
REPORT_ATTRIBUTE = "preset_marks"
# The run this xdist controller started (xdist's `testrunuid`), and the database this worker made: (server URL, name).
_RUN = pytest.StashKey[str]()
_WORKER_DATABASE = pytest.StashKey[tuple[str, str]]()
_OWN_TIMEOUT = pytest.StashKey[str]()  # on an item: why it fails (it set its own timeout)
_FAIL_ALL = pytest.StashKey[str]()  # on a worker's config: why every test of the worker fails


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


@pytest.hookimpl(wrapper=True)
def pytest_cmdline_main(config: pytest.Config) -> Iterator[None]:
    """Parallel unless the run says otherwise: no `-n` means `-n auto --dist=worksteal`. `-n0`, `-n 3`, `--dist=...`,
    `-p no:xdist` and `--pdb` are the run's own say. A wrapper, so it runs before pytest-xdist reads `-n`."""
    option = config.option
    if not hasattr(config, "workerinput") and getattr(option, "numprocesses", 0) is None:
        option.numprocesses = "auto"
        if option.dist == "no":
            option.dist = "worksteal"
    return (yield)


@pytest.hookimpl(tryfirst=True, optionalhook=True)
def pytest_xdist_auto_num_workers(config: pytest.Config) -> int | None:
    if os.environ.get("PYTEST_XDIST_AUTO_NUM_WORKERS"):
        return None  # xdist's own answer: the run asked for a number
    return parallel.auto_workers()


@pytest.hookimpl(optionalhook=True)
def pytest_configure_node(node: object) -> None:
    node.config.stash[_RUN] = node.workerinput["testrunuid"][:12]  # type: ignore[attr-defined]


def pytest_sessionstart(session: pytest.Session) -> None:
    """On an xdist worker with TEST_DATABASE_URL set: a database of its own, and the variable pointing at it, for
    the worker and the processes it starts."""
    config = session.config
    worker = getattr(config, "workerinput", None)
    url = os.environ.get(DATABASE_ENV, "").strip()
    if worker is None or not url:
        return
    name = f"{db.WORKER_DATABASE_PREFIX}_{worker['testrunuid'][:12]}_{worker['workerid']}"
    try:
        os.environ[DATABASE_ENV] = db.create_database(url, name)
    except Exception as error:
        # Every test of this worker fails with the message. Raising here instead makes xdist restart the worker, again
        # and again, with a traceback each time. The message names the error, never the URL (its password).
        config.stash[_FAIL_ALL] = (
            f"worker {worker['workerid']} cannot create its database {name} on the server {DATABASE_ENV} names "
            f"({type(error).__name__}: {error}); give the role CREATEDB, or run with -n0 to use one database"
        )
        return
    config.stash[_WORKER_DATABASE] = (url, name)


@pytest.hookimpl(tryfirst=True)
def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for item in items:
        marks = _markers(item)
        if "timeout" in marks:
            # Not a usage error here: under xdist a worker that raises while collecting takes the run down with an
            # INTERNALERROR and no message. The test fails in setup, with the message.
            item.stash[_OWN_TIMEOUT] = (
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


@pytest.hookimpl(tryfirst=True)
def pytest_runtest_setup(item: pytest.Item) -> None:
    message = item.config.stash.get(_FAIL_ALL, None) or item.stash.get(_OWN_TIMEOUT, None)
    if message is not None:
        pytest.fail(message, pytrace=False)


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


@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item: pytest.Item, call: pytest.CallInfo) -> Iterator[None]:
    """The report carries its test's tier and marks: it is counted where it arrives, and under xdist that is the
    controller, which collects nothing."""
    report = yield
    marks = _markers(item)
    setattr(
        report,
        REPORT_ATTRIBUTE,
        {"tier": tier_of(marks), "quarantined": "quarantine" in marks, "protected": "protected" in marks},
    )
    return report


def _skip_reason(report: pytest.TestReport) -> str:
    """The text a skip was given: a skipped report's `longrepr` is `(file, line, "Skipped: <reason>")`."""
    longrepr = report.longrepr
    reason = str(longrepr[2]) if isinstance(longrepr, tuple) and len(longrepr) == 3 else str(longrepr or "")
    reason = reason.removeprefix("Skipped: ").strip()
    return reason or "no reason given"


def pytest_runtest_logreport(report: pytest.TestReport) -> None:
    marks = getattr(report, REPORT_ATTRIBUTE, None) or {}
    tier = marks.get("tier", "small")
    quarantined = marks.get("quarantined", False)
    protected = marks.get("protected", False)
    if report.when == "call" or (report.when == "setup" and report.outcome in ("failed", "skipped")):
        if report.skipped:
            _summary.skipped += 1
            _summary.skips.append({"label": report.nodeid, "reason": _skip_reason(report)})
            if quarantined:
                _summary.quarantined += 1
            return
        _summary.add_ran(report.nodeid, tier, report.failed, protected)
    elif report.when == "teardown" and report.failed:
        _summary.failed += 1


def pytest_terminal_summary(terminalreporter: pytest.TerminalReporter) -> None:
    terminalreporter.write_line(_summary.line())


def pytest_sessionfinish(session: pytest.Session) -> None:
    config = session.config
    if getattr(config, "workerinput", None) is not None:
        # An xdist worker: its own database goes; the summary is the controller's, which saw every report.
        if (made := config.stash.get(_WORKER_DATABASE, None)) is not None:
            url, name = made
            try:
                db.drop_database(url, name)
            except Exception as error:  # the controller's sweep drops what is left
                print(f"[test-preset] could not drop {name}: {type(error).__name__}: {error}", file=sys.stderr)
        return
    _sweep_worker_databases(config)
    _summary.write()


def _sweep_worker_databases(config: pytest.Config) -> None:
    """The controller drops what a worker left: a worker that crashed or was killed never reached its drop."""
    run = config.stash.get(_RUN, None)
    url = os.environ.get(DATABASE_ENV, "").strip()
    if run is None or not url:
        return
    try:
        left = db.drop_databases_starting_with(url, f"{db.WORKER_DATABASE_PREFIX}_{run}_")
    except Exception as error:
        _warn(config, f"[test-preset] could not look for worker databases left behind: {type(error).__name__}: {error}")
        return
    if left:
        _warn(config, f"[test-preset] dropped worker databases a worker left behind: {', '.join(left)}")


def _warn(config: pytest.Config, line: str) -> None:
    reporter = config.pluginmanager.get_plugin("terminalreporter")
    if reporter is not None:
        reporter.write_line(line, yellow=True)
    else:
        print(line, file=sys.stderr)
