import os
from pathlib import Path

VICTIM = Path.cwd() / "planted-victim.txt"  # exists before the run (the case's prepare step)
OUTSIDE = Path.cwd() / "planted-outside.txt"


def test_removing_a_link_in_tmp_path_is_judged_by_the_link(tmp_path):
    # the link points outside the allowed roots; removing it touches only the link
    link = tmp_path / "link"
    os.symlink(VICTIM, link)
    link.unlink()
    assert not link.is_symlink()
    assert VICTIM.exists()


def test_removing_a_plain_file_outside_is_still_a_violation():
    VICTIM.unlink()


def test_writing_through_a_link_to_outside_is_still_a_violation(tmp_path):
    link = tmp_path / "link"
    os.symlink(OUTSIDE, link)
    link.write_text("x")
