import time

import pytest


@pytest.mark.medium
def test_takes_longer_than_the_medium_limit():
    time.sleep(15.5)


@pytest.mark.medium
def test_takes_longer_than_small_within_medium():
    time.sleep(5.5)
