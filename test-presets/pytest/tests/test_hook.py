"""The Python commit hook, with the real ruff the preset pins, in throwaway git repos."""

import subprocess
import sys
from pathlib import Path

import pytest

from dfox288_test_preset import hook

UNFORMATTED = "def f( a,b ):\n    return a+b\n"
FORMATTED = "def f(a, b):\n    return a + b\n"
UNUSED_IMPORT = "import os\n\n\ndef f():\n    return 1\n"


def git(root: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=root, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    git(tmp_path, "init", "-q")
    git(tmp_path, "config", "user.email", "a@b.c")
    git(tmp_path, "config", "user.name", "a")
    (tmp_path / "ok.py").write_text(FORMATTED)
    git(tmp_path, "add", "-A")
    git(tmp_path, "commit", "-q", "-m", "init", "--no-verify")
    return tmp_path


def stage(root: Path, name: str, content: str) -> None:
    (root / name).parent.mkdir(parents=True, exist_ok=True)
    (root / name).write_text(content)
    git(root, "add", "--", name)


def run(root: Path, dir: Path | None = None) -> tuple[int, str]:
    lines: list[str] = []
    code = hook.run_hook(root=root, dir=dir or root, out=lines.append, err=lines.append)
    return code, "".join(lines)


def test_formats_a_staged_file_and_stages_the_formatted_content(repo):
    stage(repo, "a.py", UNFORMATTED)
    code, out = run(repo)
    assert code == 0, out
    assert git(repo, "show", ":a.py") == FORMATTED


def test_fails_on_a_lint_violation_and_names_the_file_and_the_rule(repo):
    stage(repo, "a.py", UNUSED_IMPORT)
    code, out = run(repo)
    assert code == 1
    assert "a.py:1:8: F401" in out


def test_does_not_fix_what_it_lints(repo):
    stage(repo, "a.py", UNUSED_IMPORT)
    run(repo)
    assert git(repo, "show", ":a.py") == UNUSED_IMPORT


def test_refuses_a_partly_staged_file_by_name_and_changes_nothing(repo):
    stage(repo, "a.py", UNFORMATTED)
    (repo / "a.py").write_text(UNFORMATTED + "\nx = 1\n")
    code, out = run(repo)
    assert code == 1
    assert "partly staged" in out and "a.py" in out
    assert git(repo, "show", ":a.py") == UNFORMATTED
    assert (repo / "a.py").read_text() == UNFORMATTED + "\nx = 1\n"


def test_leaves_other_files_than_python_alone(repo):
    stage(repo, "notes.md", "# x\n")
    stage(repo, "data.json", '{"a":1}')
    code, out = run(repo)
    assert code == 0, out
    assert git(repo, "show", ":data.json") == '{"a":1}'


def test_only_looks_below_its_directory(repo):
    stage(repo, "api/a.py", UNFORMATTED)
    stage(repo, "other/b.py", UNUSED_IMPORT)
    code, out = run(repo, repo / "api")
    assert code == 0, out
    assert git(repo, "show", ":api/a.py") == FORMATTED
    assert git(repo, "show", ":other/b.py") == UNUSED_IMPORT


def test_a_syntax_error_fails_and_names_the_file(repo):
    stage(repo, "a.py", "def f(:\n")
    code, out = run(repo)
    assert code == 1
    assert "a.py" in out


def test_ships_its_own_settings(repo):
    # 100 characters: inside the shipped line length (120), outside ruff's default (88)
    line = "x = [" + ", ".join(["1"] * 31) + "]\n"
    assert 88 < len(line) <= 120
    stage(repo, "a.py", line)
    code, out = run(repo)
    assert code == 0, out
    assert git(repo, "show", ":a.py") == line


def test_the_repos_pyproject_overrides_single_settings(repo):
    (repo / "pyproject.toml").write_text('[tool.ruff]\nline-length = 60\n\n[tool.ruff.lint]\nignore = ["F401"]\n')
    long = "x = [" + ", ".join(["1"] * 31) + "]\n"
    stage(repo, "a.py", UNUSED_IMPORT + long)
    code, out = run(repo)
    assert code == 0, out  # F401 ignored by the repo
    wrapped = git(repo, "show", ":a.py")
    assert wrapped.count("\n") > (UNUSED_IMPORT + long).count("\n")  # 60 columns wrapped the list
    assert "target-version" not in out


def test_the_repos_ruff_toml_overrides_too(repo):
    (repo / "ruff.toml").write_text('[lint.per-file-ignores]\n"legacy/*.py" = ["F401"]\n')
    stage(repo, "legacy/a.py", UNUSED_IMPORT)
    stage(repo, "new/b.py", UNUSED_IMPORT)
    code, out = run(repo)
    assert code == 1
    assert "new/b.py:1:8: F401" in out and "legacy/a.py" not in out


def test_an_excluded_file_is_left_alone(repo):
    (repo / "pyproject.toml").write_text('[tool.ruff]\nextend-exclude = ["vendored"]\n')
    stage(repo, "vendored/a.py", UNFORMATTED)
    code, out = run(repo)
    assert code == 0, out
    assert git(repo, "show", ":vendored/a.py") == UNFORMATTED


def test_flatten_quotes_keys_and_values():
    assert hook.flatten({"lint": {"per-file-ignores": {"tests/**": ["S101"]}, "select": ["E"]}, "line-length": 90, "preview": True}) == [
        'lint.per-file-ignores."tests/**"=["S101"]',
        'lint.select=["E"]',
        "line-length=90",
        "preview=true",
    ]


def test_never_runs_a_type_checker_or_a_test(repo, monkeypatch):
    seen: list[list[str]] = []
    real = subprocess.run

    def spy(cmd, *a, **kw):
        seen.append(list(cmd))
        return real(cmd, *a, **kw)

    monkeypatch.setattr(hook.subprocess, "run", spy)
    stage(repo, "a.py", FORMATTED)
    run(repo)
    names = {part for cmd in seen for part in cmd}
    assert not names & {"mypy", "pyright", "ty", "pytest"}
    assert sys.executable in {cmd[0] for cmd in seen}


def test_blocks_and_formats_a_real_commit_through_a_one_line_hook(repo):
    hooks = repo / ".githooks"
    hooks.mkdir()
    (hooks / "pre-commit").write_text(f"#!/bin/sh\nexec {sys.executable} -m dfox288_test_preset.hook\n")
    (hooks / "pre-commit").chmod(0o755)
    git(repo, "config", "core.hooksPath", ".githooks")

    stage(repo, "a.py", UNFORMATTED)
    git(repo, "commit", "-q", "-m", "format me")
    assert git(repo, "show", "HEAD:a.py") == FORMATTED

    stage(repo, "b.py", UNUSED_IMPORT)
    red = subprocess.run(["git", "commit", "-q", "-m", "red"], cwd=repo, capture_output=True, text=True)
    assert red.returncode != 0
    assert "b.py:1:8: F401" in red.stderr + red.stdout


def test_main_takes_a_directory_below_the_top_level(repo, monkeypatch):
    stage(repo, "api/a.py", UNFORMATTED)
    stage(repo, "b.py", UNFORMATTED)
    monkeypatch.chdir(repo)
    assert hook.main(["--dir", "api"]) == 0
    assert git(repo, "show", ":api/a.py") == FORMATTED
    assert git(repo, "show", ":b.py") == UNFORMATTED
    assert hook.main(["--dir", ".."]) == 2
