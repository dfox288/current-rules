import pytest

from dfox288_test_preset.shape import expect_shape, load_answer, record_answer, shape_diff

REAL = {"id": 7, "name": "run", "ok": True, "owner": None, "tags": ["a", "b"], "steps": [{"n": 1, "label": "x"}]}


def test_accepts_other_values_of_the_same_shape():
    fake = {"id": 99, "name": "", "ok": False, "owner": None, "tags": [], "steps": [{"n": 2.5, "label": "y"}]}
    assert shape_diff(fake, REAL) == []


def test_reports_missing_extra_and_kind_change_with_paths():
    fake = {"id": "7", "name": "run", "ok": True, "owner": None, "tags": ["a"], "steps": [{"n": 1}], "extra": 1}
    assert sorted(shape_diff(fake, REAL)) == [
        "$.extra: key is not in the recorded answer",
        "$.id: expected number, got string",
        "$.steps[0].label: key is missing",
    ]


def test_checks_every_element():
    assert shape_diff({**REAL, "tags": ["a", 2]}, REAL) == ["$.tags[1]: expected string, got number"]


def test_a_bool_is_not_a_number_and_null_is_not_a_value():
    assert shape_diff({**REAL, "id": True}, REAL) == ["$.id: expected number, got boolean"]
    assert shape_diff({**REAL, "owner": "bob"}, REAL) == ["$.owner: expected null, got string"]
    assert shape_diff({**REAL, "tags": {}}, REAL) == ["$.tags: expected array, got object"]


def test_merges_recorded_elements():
    recorded = [{"a": 1, "b": "x"}, {"a": None}]
    assert shape_diff([{"a": 2}, {"a": None, "b": "q"}], recorded) == []
    assert shape_diff([{"a": "no"}], recorded) == ["$[0].a: expected null | number, got string"]
    assert shape_diff([{"b": "only"}], recorded) == ["$[0].a: key is missing"]


def test_empty_recorded_array_accepts_any_element():
    assert shape_diff({"rows": [1, "a"]}, {"rows": []}) == []


def test_reports_a_value_json_cannot_hold():
    assert shape_diff({"id": object()}, {"id": 1}) == ["$.id: got object, which is not JSON data"]


def test_record_then_expect(tmp_path):
    file = tmp_path / "nested" / "run.json"
    record_answer(file, REAL)
    assert load_answer(file) == REAL
    expect_shape({**REAL, "id": 8}, file)
    with pytest.raises(AssertionError, match=r"\$\.id: expected number, got string\n.*re-record on purpose"):
        expect_shape({**REAL, "id": "x"}, file)


def test_missing_recording_fails_and_is_not_created(tmp_path):
    file = tmp_path / "absent.json"
    with pytest.raises(FileNotFoundError, match="no recorded answer at"):
        expect_shape(REAL, file)
    assert not file.exists()


def test_record_refuses_non_json(tmp_path):
    with pytest.raises(TypeError, match="not JSON data"):
        record_answer(tmp_path / "bad.json", {"f": object()})
    assert not (tmp_path / "bad.json").exists()
