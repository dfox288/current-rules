"""Under xdist each worker has a database of its own on the server TEST_DATABASE_URL names (README, "Parallel
runs"). Needs that server: TEST_DATABASE_URL is set where the preset's tests run (CI, a container at the desk)."""

import os
import re
from urllib.parse import urlsplit

import pytest
from dfox288_test_preset.db import DATABASE_ENV, admin_connect, create_database, database_url, drop_database

WORKER_DATABASE = re.compile(r"^dfox288_worker_[0-9a-f]{12}_gw\d+$")

# A medium test of the inner suite: where it runs, which database its connection and its variable point at, and
# what a process it starts sees.
SUITE = {
    "test_where.py": '''
import os
import subprocess
import sys
from urllib.parse import urlsplit

import pytest
from dfox288_test_preset.db import DATABASE_ENV, admin_connect


@pytest.mark.medium
@pytest.mark.parametrize("n", range(4))
def test_where_am_i(n):
    url = os.environ[DATABASE_ENV]
    conn = admin_connect(url)
    cur = conn.cursor()
    cur.execute("select current_database()")
    database = cur.fetchone()[0]
    conn.close()
    child = subprocess.run(
        [sys.executable, "-c", "import os; print(os.environ['TEST_DATABASE_URL'])"], capture_output=True, text=True
    ).stdout.strip()
    with open(os.path.join(os.environ["INNER_DIR"], "where.txt"), "a") as f:
        f.write("%s %s %s %s\\n" % (os.environ.get("PYTEST_XDIST_WORKER", "main"), database, urlsplit(url).path[1:], urlsplit(child).path[1:]))
'''
}


def where(inner) -> list[list[str]]:
    return [line.split() for line in (inner.dir / "where.txt").read_text().splitlines()]


def base_database() -> str:
    return urlsplit(os.environ[DATABASE_ENV]).path[1:]


@pytest.mark.medium
def test_each_worker_has_a_database_of_its_own_and_drops_it(run_inner, worker_databases):
    inner = run_inner("-n", "2", "--dist=load", files=SUITE)
    inner.result.assert_outcomes(passed=4)
    seen = where(inner)
    assert {worker for worker, *_ in seen} == {"gw0", "gw1"}
    for worker, database, from_variable, in_child in seen:
        assert database == from_variable == in_child  # the connection, the variable and a child process agree
        assert WORKER_DATABASE.match(database) and database.endswith(f"_{worker}")
        assert database != base_database()
    assert len({database for _, database, *_ in seen}) == 2  # one per worker
    (run_id,) = inner.run_ids()
    assert worker_databases(run_id) == []  # dropped at the end


@pytest.mark.medium
def test_a_worker_database_is_empty_and_its_own(run_inner):
    suite = {
        "test_empty.py": '''
import os

import pytest
from dfox288_test_preset.db import DATABASE_ENV, admin_connect


@pytest.mark.medium
def test_nothing_in_it_but_what_this_worker_makes():
    conn = admin_connect(os.environ[DATABASE_ENV])
    cur = conn.cursor()
    cur.execute("select count(*) from pg_tables where schemaname = 'public'")
    assert cur.fetchone()[0] == 0
    cur.execute("create table made_here (id int)")
    conn.close()
'''
    }
    # the table made in one worker's database is not in the next run's: databases are not reused
    for _ in range(2):
        run_inner("-n", "2", files=suite).result.assert_outcomes(passed=1)


@pytest.mark.medium
def test_without_xdist_nothing_connects_to_the_server_to_make_a_database(run_inner):
    # `-n0` with a server nobody can reach: an attempt to create a database would fail the run
    unreachable = "postgres://nobody:s3cret@127.0.0.1:1/nothing"
    inner = run_inner("-n0", files={"test_a.py": "def test_a(): pass"}, env={DATABASE_ENV: unreachable})
    inner.result.assert_outcomes(passed=1)


@pytest.mark.medium
def test_without_xdist_the_tests_use_the_server_database(run_inner):
    inner = run_inner("-n0", files=SUITE)
    inner.result.assert_outcomes(passed=4)
    assert set(map(tuple, where(inner))) == {("main", base_database(), base_database(), base_database())}


@pytest.mark.medium
def test_without_the_variable_nothing_is_created(run_inner, worker_databases):
    inner = run_inner("-n", "2", "--dist=load", files={"test_a.py": "\n".join(f"def test_{n}(): pass" for n in range(4))}, env={DATABASE_ENV: None})
    inner.result.assert_outcomes(passed=4)
    (run_id,) = inner.run_ids()
    assert worker_databases(run_id) == []
    assert "dfox288_worker" not in inner.output()


@pytest.mark.medium
def test_a_worker_that_cannot_create_its_database_errors_its_tests_with_the_reason_and_not_the_url(run_inner):
    unreachable = "postgres://nobody:s3cret@127.0.0.1:1/nothing"
    suite = {"test_a.py": "\n".join(f"def test_{n}(): pass" for n in range(4))}
    inner = run_inner("-n", "2", "--dist=load", files=suite, env={DATABASE_ENV: unreachable})
    inner.result.assert_outcomes(errors=4)
    assert "cannot create its database" in inner.output()
    assert "crashed" not in inner.output()  # the workers stay up: no restart loop
    assert "s3cret" not in inner.output()
    assert unreachable not in inner.output()


@pytest.mark.medium
def test_the_controller_drops_what_a_crashed_worker_left(run_inner, worker_databases):
    suite = {
        "test_crash.py": '''
import os

def test_the_worker_dies_here():
    os._exit(3)

def test_the_others_go_on():
    pass
'''
    }
    inner = run_inner("-n", "2", "--dist=load", files=suite)
    assert inner.result.ret != 0
    assert "crashed" in inner.output()
    (run_id,) = inner.run_ids()
    assert "dropped worker databases a worker left behind" in inner.output()
    assert worker_databases(run_id) == []


@pytest.mark.medium
def test_create_and_drop_database_and_the_url_for_it():
    url = os.environ[DATABASE_ENV]
    name = "dfox288_worker_000000000000_unittest"
    drop_database(url, name)
    try:
        made = create_database(url, name)
        assert urlsplit(made).path == f"/{name}"
        assert made == database_url(url, name)
        conn = admin_connect(made)
        conn.close()
    finally:
        drop_database(url, name)
    with pytest.raises(Exception, match="does not exist"):
        admin_connect(made)


def test_a_name_that_is_not_plain_is_refused():
    with pytest.raises(ValueError, match="not a plain database name"):
        drop_database("postgres://u:p@127.0.0.1:1/x", 'x"; drop database y; --')
