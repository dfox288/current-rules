import time

import pytest


@pytest.mark.large
def test_takes_longer_than_the_large_limit():
    time.sleep(30.5)
