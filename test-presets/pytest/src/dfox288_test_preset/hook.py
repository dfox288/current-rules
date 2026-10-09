"""The Python commit hook: `ruff format` and `ruff check` on the staged `.py` files. No type checker (R144), never tests
(they are the gate's, `testing.md`), never the network: ruff is a dependency of this package, so the repo's install
already has it and the hook runs inside a worker container without one.

Settings: the ones shipped beside this module (`ruff.toml`); a repo's own `[tool.ruff]` in `pyproject.toml`, or its
`ruff.toml` / `.ruff.toml`, overrides them key by key. A partly staged file is refused by name: `ruff format` rewrites
the file from the working tree, so re-staging it would commit the unstaged hunks too.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import tomllib
from collections.abc import Callable
from pathlib import Path

SHIPPED = Path(__file__).with_name("ruff.toml")
_BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def _git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["git", *args], cwd=root, capture_output=True, text=True)


def staged_files(root: Path, dir: Path) -> list[str]:
    """Staged `.py` files (added, copied, modified, renamed) below `dir`, relative to it, that still exist."""
    r = _git(root, "diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z")
    if r.returncode != 0:
        raise RuntimeError(f"git diff --cached failed: {r.stderr}")
    prefix = dir.resolve().relative_to(root.resolve()).as_posix()
    files = []
    for f in filter(None, r.stdout.split("\0")):
        if prefix != "." and not f.startswith(prefix + "/"):
            continue
        rel = f if prefix == "." else f[len(prefix) + 1 :]
        if rel.endswith(".py") and (dir / rel).is_file():
            files.append(rel)
    return files


def _key(part: str) -> str:
    return part if _BARE_KEY.match(part) else json.dumps(part)


def flatten(table: dict, prefix: str = "") -> list[str]:
    """A TOML table as `dotted.key=value` pairs, the form ruff takes as `--config` overrides."""
    pairs = []
    for name, value in table.items():
        key = prefix + _key(name)
        if isinstance(value, dict):
            pairs.extend(flatten(value, key + "."))
        elif isinstance(value, (str, bool, int, float, list)):
            pairs.append(f"{key}={json.dumps(value)}")
        else:
            raise ValueError(f"ruff setting {key}: a {type(value).__name__} cannot be passed as an override")
    return pairs


def repo_settings(dir: Path) -> dict:
    """The repo's own ruff settings: `ruff.toml`, `.ruff.toml` or `[tool.ruff]`, the first that exists (ruff's order)."""
    for name in (".ruff.toml", "ruff.toml"):
        if (dir / name).is_file():
            return tomllib.loads((dir / name).read_text())
    pyproject = dir / "pyproject.toml"
    if pyproject.is_file():
        return tomllib.loads(pyproject.read_text()).get("tool", {}).get("ruff", {})
    return {}


def ruff_config(dir: Path) -> list[str]:
    """`--config` arguments: the shipped file, then the repo's keys on top (an inline override beats the file)."""
    args = ["--config", str(SHIPPED)]
    for pair in flatten(repo_settings(dir)):
        args += ["--config", pair]
    return args


def run_hook(
    root: Path,
    dir: Path,
    out: Callable[[str], object] = sys.stdout.write,
    err: Callable[[str], object] = sys.stderr.write,
) -> int:
    root, dir = root.resolve(), dir.resolve()
    files = staged_files(root, dir)
    if not files:
        return 0

    partly = [f for f in files if _git(root, "diff", "--quiet", "--", str(dir / f)).returncode != 0]
    if partly:
        err("pre-commit: partly staged (staged and unstaged changes both present), refusing the commit:\n")
        for f in partly:
            err(f"  {(dir / f).relative_to(root).as_posix()}\n")
        err("pre-commit: stage the rest of the file, or unstage the extra hunks, and commit again.\n")
        return 1

    timing = os.environ.get("PRESET_HOOK_TIMING") == "1"
    try:
        config = ruff_config(dir)
    except (ValueError, tomllib.TOMLDecodeError) as e:
        err(f"pre-commit: cannot read the repo's ruff settings: {e}\n")
        return 1

    def step(name: str, args: list[str], fail: str) -> bool:
        started = time.perf_counter()
        r = subprocess.run([sys.executable, "-m", "ruff", *args], cwd=dir, capture_output=True, text=True)
        out(r.stdout)
        err(r.stderr)
        if timing:
            err(f"pre-commit: {name} {time.perf_counter() - started:.1f}s\n")
        if r.returncode != 0:
            err(f"pre-commit: {fail}\n")
        return r.returncode == 0

    if not step("ruff format", ["format", "--force-exclude", *config, "--", *files], "ruff format failed on a staged file (named above); fix it and commit again."):
        return 1
    added = _git(root, "add", "--", *[str(dir / f) for f in files])
    if added.returncode != 0:
        err(f"pre-commit: git add failed: {added.stderr}")
        return 1
    if not step("ruff check", ["check", "--no-fix", "--force-exclude", "--output-format=concise", *config, "--", *files], "ruff check found a problem in a staged file (file, line and rule above); fix it and commit again."):
        return 1
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="dfox288-pre-commit", description="ruff format and ruff check on the staged .py files")
    parser.add_argument("--dir", help="the project folder, relative to the git top level (default: the top level)")
    ns = parser.parse_args(argv)
    top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True)
    if top.returncode != 0:
        sys.stderr.write("pre-commit: not inside a git repository\n")
        return 1
    root = Path(top.stdout.strip()).resolve()
    dir = (root / (ns.dir or os.environ.get("PRESET_HOOK_DIR") or ".")).resolve()
    if dir != root and root not in dir.parents:
        sys.stderr.write(f"pre-commit: {dir} is not inside {root}\n")
        return 2
    return run_hook(root, dir)


if __name__ == "__main__":
    raise SystemExit(main())
