"""The preset runs tests in parallel unless the run says otherwise (README, "Parallel runs")."""

import re

import pytest
from dfox288_test_preset.parallel import auto_workers

SUITE = {"test_a.py": "\n".join(f"def test_{n}(): pass" for n in range(8))}


@pytest.mark.parametrize(
    ("cpus", "workers"),
    [(1, 4), (2, 4), (4, 4), (5, 5), (6, 6), (7, 6), (64, 6)],
)
def test_auto_is_one_per_core_between_4_and_6(cpus, workers):
    assert auto_workers(cpus) == workers


def created_workers(inner) -> int:
    match = re.search(r"created: (\d+)/(\d+) workers", inner.output())
    assert match, inner.output()
    return int(match.group(1))


@pytest.mark.medium
def test_no_n_means_auto_workers_with_worksteal(run_inner):
    inner = run_inner(files=SUITE)
    inner.result.assert_outcomes(passed=8)
    assert 4 <= created_workers(inner) <= 6
    assert "dist=worksteal" in inner.output()
    assert "main" not in inner.workers_that_ran_tests()


@pytest.mark.medium
def test_n0_runs_in_one_process_and_n_is_the_runs_own_say(run_inner):
    one = run_inner("-n0", files=SUITE)
    one.result.assert_outcomes(passed=8)
    assert "created:" not in one.output()
    assert one.workers_that_ran_tests() == {"main"}


@pytest.mark.medium
def test_an_explicit_count_is_kept_and_takes_xdists_own_dist(run_inner):
    inner = run_inner("-n", "3", files=SUITE)
    inner.result.assert_outcomes(passed=8)
    assert created_workers(inner) == 3
    assert "dist=load" in inner.output()


@pytest.mark.medium
def test_the_runs_own_dist_is_kept(run_inner):
    inner = run_inner("--dist=loadfile", files=SUITE)
    inner.result.assert_outcomes(passed=8)
    assert "dist=loadfile" in inner.output()


@pytest.mark.medium
def test_the_environments_worker_count_is_kept(run_inner):
    inner = run_inner(files=SUITE, env={"PYTEST_XDIST_AUTO_NUM_WORKERS": "2"})
    inner.result.assert_outcomes(passed=8)
    assert created_workers(inner) == 2


@pytest.mark.medium
def test_without_xdist_the_plugin_still_loads_and_the_run_is_green(run_inner):
    inner = run_inner("-p", "no:xdist", files=SUITE)
    inner.result.assert_outcomes(passed=8)
    assert inner.workers_that_ran_tests() == {"main"}
    assert inner.summary()["tests"] == 8
