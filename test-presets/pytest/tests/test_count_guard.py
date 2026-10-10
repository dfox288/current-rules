"""The count guard states the same run under xdist as in one process: the controller counts, the tier of each test
comes with its report, and only the controller writes the summary (README, "Parallel runs")."""

import pytest

SUITE = {
    "test_tiers.py": '''
import pytest

def test_small_one(): pass
def test_small_two(): pass

@pytest.mark.protected
def test_protected_small(): pass

@pytest.mark.medium
def test_medium_one(): pass

@pytest.mark.medium
@pytest.mark.protected
def test_protected_medium(): pass

@pytest.mark.large
def test_large_one(): pass

@pytest.mark.quarantine
def test_quarantined(): pass

class TestMediumClass:
    pytestmark = pytest.mark.medium
    def test_a(self): pass
    def test_b(self): pass
''',
    # a directory or a file named like a tier makes nothing of that tier
    "large/test_in_a_directory_named_large.py": "def test_still_small(): pass",
    "test_medium.py": "def test_in_a_file_named_medium(): pass",
}
EXPECTED = {
    "files": 3,
    "tests": 10,
    "skipped": 1,
    "quarantined": 1,
    "failed": 0,
    "tiers": {
        "small": {"files": 3, "tests": 5, "protected": 1},
        "medium": {"files": 1, "tests": 4, "protected": 1},
        "large": {"files": 1, "tests": 1, "protected": 0},
    },
}
LINE = "ran 3 files, 10 tests (small 5, medium 4, large 1); skipped 1, quarantined 1, flaky 0"


def counted(summary: dict) -> dict:
    return {k: v for k, v in summary.items() if k in EXPECTED}


@pytest.mark.medium
def test_one_process_counts_each_tier(run_inner):
    inner = run_inner("-n0", files=SUITE)
    inner.result.assert_outcomes(passed=10, skipped=1)
    assert counted(inner.summary()) == EXPECTED
    assert LINE in inner.output()


@pytest.mark.medium
def test_two_workers_count_the_same_run(run_inner):
    # --dist=load: each worker is sure to run some of the tests
    inner = run_inner("-n", "2", "--dist=load", files=SUITE)
    inner.result.assert_outcomes(passed=10, skipped=1)
    assert inner.workers_that_ran_tests() == {"gw0", "gw1"}
    assert counted(inner.summary()) == EXPECTED
    assert LINE in inner.output()


@pytest.mark.medium
def test_only_the_controller_writes_the_summary(run_inner):
    inner = run_inner("-n", "2", "--dist=load", files=SUITE)
    writers = [line[1] for line in inner.lines if line[0] == "WRITE"]
    assert writers == ["main"]


@pytest.mark.medium
def test_break_it_a_report_without_its_marks_counts_every_test_small(run_inner):
    # What the preset did before: the controller, which collects nothing, had no tier for a test and counted every
    # one as small. Take the marks off the reports and the counts are wrong (medium 0, large 0): the assertions
    # above have teeth.
    sabotage = """
import pytest

@pytest.hookimpl(wrapper=True)
def pytest_runtest_makereport(item, call):
    report = yield
    del report.preset_marks
    return report
"""
    inner = run_inner("-n", "2", "--dist=load", files=SUITE, conftest=sabotage)
    tiers = inner.summary()["tiers"]
    assert counted(inner.summary()) != EXPECTED
    assert (tiers["small"]["tests"], tiers["medium"]["tests"], tiers["large"]["tests"]) == (10, 0, 0)


SKIPS = {
    "test_skips.py": '''
import pytest

def test_ran(): pass

@pytest.mark.skip(reason="needs the staging bucket")
def test_marked(): pass

@pytest.mark.skip
def test_marked_without_reason(): pass

@pytest.mark.skipif(True, reason="no GPU on this host")
def test_conditional(): pass

def test_in_the_body():
    pytest.skip("the body decided")

@pytest.mark.quarantine
def test_quarantined(): pass
''',
}


@pytest.mark.medium
def test_every_skip_is_in_the_summary_with_its_reason(run_inner):
    inner = run_inner("-n0", files=SKIPS)
    inner.result.assert_outcomes(passed=1, skipped=5)
    skips = {s["label"]: s["reason"] for s in inner.summary()["skips"]}
    assert skips == {
        "test_skips.py::test_marked": "needs the staging bucket",
        "test_skips.py::test_marked_without_reason": "unconditional skip",
        "test_skips.py::test_conditional": "no GPU on this host",
        "test_skips.py::test_in_the_body": "the body decided",
        "test_skips.py::test_quarantined": "quarantined: out of the suite that blocks a merge",
    }
    assert inner.summary()["skipped"] == 5
    assert inner.summary()["quarantined"] == 1


@pytest.mark.medium
def test_two_workers_list_the_same_skips(run_inner):
    inner = run_inner("-n", "2", "--dist=load", files=SKIPS)
    assert sorted(s["label"] for s in inner.summary()["skips"]) == sorted(
        f"test_skips.py::{n}"
        for n in ("test_marked", "test_marked_without_reason", "test_conditional", "test_in_the_body", "test_quarantined")
    )
