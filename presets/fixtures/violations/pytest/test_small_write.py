import os
import shutil
import sqlite3
from pathlib import Path

TARGET = Path.cwd() / "planted-write.txt"


def test_small_writes_outside_tmp_path_open():
    with open(TARGET, "w") as f:
        f.write("x")


def test_small_writes_outside_tmp_path_pathlib():
    TARGET.write_text("x")


def test_small_makes_a_dir_outside():
    os.mkdir(Path.cwd() / "planted-dir")


def test_small_copies_outside(tmp_path):
    (tmp_path / "a.txt").write_text("a")
    shutil.copyfile(tmp_path / "a.txt", Path.cwd() / "planted-copy.txt")


def test_small_creates_a_sqlite_file_outside():
    sqlite3.connect(str(Path.cwd() / "planted.db")).close()


def test_small_swallows_the_violation():
    try:
        TARGET.write_text("x")
    except Exception:
        pass
