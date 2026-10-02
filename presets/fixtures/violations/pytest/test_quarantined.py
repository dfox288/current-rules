import pytest


@pytest.mark.quarantine
def test_flaky_one():
    assert False
