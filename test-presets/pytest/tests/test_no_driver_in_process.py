"""The preset never imports its own dependencies into the process under test (README, "Parallel runs"). A repo may
vendor its own pg8000, scramp and asn1crypto and test that it loads them from there (lookout's `test_vendor.py`); the
preset's driver in `sys.modules` would be the one the repo's tests then run on. The worker databases are made and
dropped in a child process. Needs the server TEST_DATABASE_URL names."""

import os
from urllib.parse import urlsplit

import pytest
from dfox288_test_preset.db import DATABASE_ENV, create_database, drop_database, drop_databases_starting_with

DRIVER_MODULES = ("pg8000", "scramp", "asn1crypto")

# In the inner suite: the modules of the driver every process holds at the end of its session (the plugin has made the
# worker's database at its start and dropped it by then; the controller has swept), and at a test.
CONFTEST = '''
import os
import sys

import pytest

DRIVER = ("pg8000", "scramp", "asn1crypto")


def _loaded():
    return sorted(m for m in sys.modules if m.split(".")[0] in DRIVER)


@pytest.hookimpl(trylast=True)
def pytest_sessionfinish(session):
    with open(os.path.join(os.environ["INNER_DIR"], "loaded.txt"), "a") as f:
        f.write("%s %s\\n" % (os.environ.get("PYTEST_XDIST_WORKER", "main"), ",".join(_loaded()) or "-"))
'''

SUITE = {
    "test_inside.py": '''
import os
import sys
from urllib.parse import urlsplit

import pytest

DRIVER = ("pg8000", "scramp", "asn1crypto")


@pytest.mark.medium
@pytest.mark.parametrize("n", range(4))
def test_the_driver_is_not_in_the_process(n):
    # the worker has its own database (the plugin made it at the session start), so this is not vacuous
    assert urlsplit(os.environ["TEST_DATABASE_URL"]).path.startswith("/dfox288_worker_")
    assert [m for m in sys.modules if m.split(".")[0] in DRIVER] == []
'''
}


def loaded(inner) -> dict[str, str]:
    return dict(line.split() for line in (inner.dir / "loaded.txt").read_text().splitlines())


@pytest.mark.medium
def test_no_driver_is_in_the_worker_or_the_controller(run_inner):
    inner = run_inner("-n", "2", "--dist=load", files=SUITE, conftest=CONFTEST)
    inner.result.assert_outcomes(passed=4)
    seen = loaded(inner)
    assert set(seen) == {"main", "gw0", "gw1"}
    assert seen == {"main": "-", "gw0": "-", "gw1": "-"}


@pytest.mark.medium
def test_the_public_functions_do_not_import_the_driver_either():
    # in a fresh interpreter: the parent of a create/drop stays as clean as the plugin keeps the worker
    import subprocess
    import sys

    program = (
        "import sys\n"
        "from dfox288_test_preset.db import create_database, drop_database, drop_databases_starting_with\n"
        "import os\n"
        "url = os.environ['TEST_DATABASE_URL']\n"
        "name = 'dfox288_worker_000000000000_nodriver'\n"
        "drop_database(url, name)\n"
        "create_database(url, name)\n"
        "drop_databases_starting_with(url, name)\n"
        f"print(sorted(m for m in sys.modules if m.split('.')[0] in {DRIVER_MODULES!r}))\n"
    )
    done = subprocess.run([sys.executable, "-c", program], capture_output=True, text=True, check=False)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "[]"


@pytest.mark.medium
def test_the_public_functions_work_through_the_child_process():
    url = os.environ[DATABASE_ENV]
    prefix = "dfox288_worker_000000000000_child"
    names = [f"{prefix}_{n}" for n in range(2)]
    try:
        for name in names:
            assert urlsplit(create_database(url, name)).path == f"/{name}"
        assert drop_databases_starting_with(url, prefix) == names
        assert drop_databases_starting_with(url, prefix) == []
    finally:
        for name in names:
            drop_database(url, name)


@pytest.mark.medium
def test_a_failure_of_the_child_names_the_error_and_never_the_url():
    unreachable = "postgres://nobody:s3cret@127.0.0.1:1/nothing"
    for call in (
        lambda: create_database(unreachable, "dfox288_worker_000000000000_x"),
        lambda: drop_database(unreachable, "dfox288_worker_000000000000_x"),
        lambda: drop_databases_starting_with(unreachable, "dfox288_worker_000000000000_"),
    ):
        with pytest.raises(Exception) as caught:
            call()
        assert "s3cret" not in str(caught.value)
        assert unreachable not in str(caught.value)
        assert str(caught.value)  # it says something


@pytest.mark.medium
def test_the_url_is_not_on_the_child_s_command_line(monkeypatch):
    import subprocess

    seen: list[list[str]] = []
    real = subprocess.run

    def spy(args, *a, **kw):
        seen.append(list(args))
        return real(args, *a, **kw)

    monkeypatch.setattr(subprocess, "run", spy)
    url = os.environ[DATABASE_ENV]
    name = "dfox288_worker_000000000000_cmdline"
    create_database(url, name)
    drop_database(url, name)
    assert len(seen) == 2
    password = urlsplit(url).password or ""
    for args in seen:
        assert url not in " ".join(args)
        assert not password or password not in args
