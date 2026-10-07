"""The shape-compare helper (testing.md, outside-service fakes): a fake's answer is compared with a recorded real
answer by shape, never by value. Shape means the kind of each value (null, boolean, number, string, array, object),
the keys of each object and the shape of an array's elements. Strings and numbers may differ, keys and kinds may not.
A recording is a JSON file holding one real answer; `record_answer` writes it and is the only function here that
writes, so a re-record is an explicit command a repo wires to its own script.

    expect_shape(fake.run(), "tests/recorded/run.json")      # raises AssertionError listing every difference
    record_answer("tests/recorded/run.json", real_answer)    # only from the command that calls the real service

Same rules as the Vitest preset's `shape` export: the root path is `$`, a recorded array stands for any number of
elements of the shape all its elements share (an empty one accepts any element), a key some recorded elements lack
is optional, an integer and a float are both `number`.
"""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class _Shape:
    kinds: set[str]
    keys: dict[str, tuple["_Shape", bool]] | None = None  # name -> (shape, optional)
    items: "_Shape | None" = None


def _kind(value: Any, path: str) -> str:
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, (int, float)):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, (list, tuple)):
        return "array"
    if isinstance(value, dict):
        return "object"
    raise TypeError(f"{path}: a {type(value).__name__} is not JSON data")


def _shape_of(value: Any, path: str) -> _Shape:
    kind = _kind(value, path)
    shape = _Shape({kind})
    if kind == "object":
        shape.keys = {}
        for key, child in value.items():
            if not isinstance(key, str):
                raise TypeError(f"{path}: key {key!r} is not a string")
            shape.keys[key] = (_shape_of(child, f"{path}.{key}"), False)
    if kind == "array":
        for i, child in enumerate(value):
            nxt = _shape_of(child, f"{path}[{i}]")
            shape.items = nxt if shape.items is None else _merge(shape.items, nxt)
    return shape


def _merge(a: _Shape, b: _Shape) -> _Shape:
    merged = _Shape(a.kinds | b.kinds)
    if a.keys is not None or b.keys is not None:
        left_keys, right_keys = a.keys or {}, b.keys or {}
        merged.keys = {}
        for key in list(left_keys) + [k for k in right_keys if k not in left_keys]:
            left, right = left_keys.get(key), right_keys.get(key)
            if left and right:
                merged.keys[key] = (_merge(left[0], right[0]), left[1] or right[1])
            else:
                merged.keys[key] = ((left or right)[0], True)
    if a.items is not None or b.items is not None:
        merged.items = _merge(a.items, b.items) if a.items and b.items else (a.items or b.items)
    return merged


def _check(actual: Any, shape: _Shape, path: str, out: list[str]) -> None:
    try:
        kind = _kind(actual, path)
    except TypeError:
        out.append(f"{path}: got {type(actual).__name__}, which is not JSON data")
        return
    if kind not in shape.kinds:
        out.append(f"{path}: expected {' | '.join(sorted(shape.kinds))}, got {kind}")
        return
    if kind == "object" and shape.keys is not None:
        for key in actual:
            if key not in shape.keys:
                out.append(f"{path}.{key}: key is not in the recorded answer")
        for key, (child, optional) in shape.keys.items():
            if key not in actual:
                if not optional:
                    out.append(f"{path}.{key}: key is missing")
                continue
            _check(actual[key], child, f"{path}.{key}", out)
    if kind == "array" and shape.items is not None:
        for i, child in enumerate(actual):
            _check(child, shape.items, f"{path}[{i}]", out)


def shape_diff(actual: Any, recorded: Any) -> list[str]:
    """The differences between a fake's answer and a recorded real answer, one `path: what` line each.

    Empty means the shapes match. Kinds in a union are listed in alphabetical order."""
    out: list[str] = []
    _check(actual, _shape_of(recorded, "$"), "$", out)
    return out


def load_answer(file: str | Path) -> Any:
    """Reads a recorded answer written by `record_answer`. Raises, naming the file, when it does not exist."""
    path = Path(file)
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise FileNotFoundError(
            f"no recorded answer at {path}: record it on purpose with record_answer (your repo's record command)"
        ) from None
    return json.loads(text)


def expect_shape(actual: Any, file: str | Path) -> None:
    """Raises AssertionError, listing every difference, unless `actual` has the shape of the recording in `file`."""
    diffs = shape_diff(actual, load_answer(file))
    if diffs:
        listing = "\n".join(f"  {d}" for d in diffs)
        raise AssertionError(
            f"the answer differs in shape from the recording {file}:\n{listing}\n"
            "If the real service changed, re-record on purpose (your repo's record command) and update the fake."
        )


def record_answer(file: str | Path, answer: Any) -> None:
    """Writes a real answer as the recording. Call it only from a command that talks to the real service and is run
    on purpose; a test run never calls it. Rejects what JSON cannot hold."""
    _shape_of(answer, "$")
    path = Path(file)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(answer, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
