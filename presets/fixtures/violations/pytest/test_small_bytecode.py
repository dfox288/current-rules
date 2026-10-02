import importlib
import sys
from pathlib import Path

PROBE = Path(__file__).with_name("_bytecode_probe.py")
TARGET = Path.cwd() / "planted-plain.txt"


def test_lazy_import_writes_bytecode_outside_the_temp_dirs():
    # importlib writes `<name>.pyc.<digits>` into __pycache__, then renames it onto the .pyc
    cached = Path(importlib.util.cache_from_source(str(PROBE)))
    cached.unlink(missing_ok=True)
    sys.dont_write_bytecode = False
    sys.path.insert(0, str(PROBE.parent))
    try:
        module = importlib.import_module("_bytecode_probe")
    finally:
        sys.path.remove(str(PROBE.parent))
        sys.modules.pop("_bytecode_probe", None)
    assert module.VALUE == 1
    assert cached.exists()


def test_plain_file_next_to_the_cache_is_still_a_violation():
    TARGET.write_text("x")


def test_pyc_lookalike_outside_a_pycache_is_still_a_violation():
    (Path.cwd() / "planted-lookalike.pyc.123").write_text("x")
