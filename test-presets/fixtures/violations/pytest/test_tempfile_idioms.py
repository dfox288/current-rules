import tempfile
from pathlib import Path


def test_named_temporary_file():
    with tempfile.NamedTemporaryFile("w+") as f:
        f.write("x")
        f.flush()
        assert Path(f.name).read_text() == "x"


def test_temporary_file():
    with tempfile.TemporaryFile("w+") as f:
        f.write("x")
        f.seek(0)
        assert f.read() == "x"


def test_mkstemp_and_remove():
    import os

    fd, name = tempfile.mkstemp()
    os.write(fd, b"x")
    os.close(fd)
    os.remove(name)


def test_spooled_temporary_file_rolls_over():
    with tempfile.SpooledTemporaryFile(max_size=4, mode="w+") as f:
        f.write("0123456789")
        f.seek(0)
        assert f.read() == "0123456789"
