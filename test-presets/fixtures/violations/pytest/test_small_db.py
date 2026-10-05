from dfox288_test_preset.db import test_database_url


def test_small_asks_for_the_database():
    assert test_database_url()
