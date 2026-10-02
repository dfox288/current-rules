import tempfile
import unittest
from pathlib import Path

from fixture_pkg import add


class AddTests(unittest.TestCase):
    """An existing unittest class runs under pytest unchanged, including its own tempfile use."""

    def test_add(self):
        self.assertEqual(add(1, 1), 2)

    def test_temp_dir_of_its_own(self):
        with tempfile.TemporaryDirectory() as d:
            (Path(d) / "x.txt").write_text("x")
            self.assertEqual((Path(d) / "x.txt").read_text(), "x")


def test_tmp_path_is_writable(tmp_path):
    (tmp_path / "x.txt").write_text("x")
    assert (tmp_path / "x.txt").read_text() == "x"
