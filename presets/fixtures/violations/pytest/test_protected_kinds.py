import pytest


@pytest.mark.protected
def test_direct():
    assert True


@pytest.mark.protected
class TestThroughClass:
    def test_one(self):
        assert True

    def test_two(self):
        assert True


def test_not_protected():
    assert True
