import pytest

from fixture_pkg import add


@pytest.mark.protected
def test_keeps_the_sign():
    """Guards: addition never loses the sign of a negative operand (a stand-in for a safety guard)."""
    assert add(-1, -1) == -2
