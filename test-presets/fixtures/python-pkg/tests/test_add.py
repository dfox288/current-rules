import os
import time

from fixture_pkg import add


def test_adds_two_numbers():
    assert add(2, 3) == 5


def test_runs_in_utc():
    assert os.environ["TZ"] == "UTC"
    assert time.timezone == 0
