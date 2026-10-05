import pytest


@pytest.mark.medium
def test_stores_a_row_in_a_schema_of_its_own(schema):
    conn = schema.connection()
    cur = conn.cursor()
    cur.execute("create table items (id int primary key, name text)")
    cur.execute("insert into items values (1, 'a')")
    cur.execute("select name from items")
    assert [r[0] for r in cur.fetchall()] == ["a"]
    cur.execute("select current_schema()")
    assert [r[0] for r in cur.fetchall()] == [schema.name]
    conn.commit()
    conn.close()


@pytest.mark.medium
def test_writes_files_outside_tmp_path(tmp_path_factory):
    path = tmp_path_factory.getbasetemp() / "medium-writes.txt"
    path.write_text("x")
    assert path.read_text() == "x"
