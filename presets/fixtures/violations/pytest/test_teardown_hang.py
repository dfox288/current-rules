import pytest


@pytest.mark.medium
def test_leaves_a_transaction_open(schema):
    conn = schema.connection()
    cur = conn.cursor()
    cur.execute("create table t (id int)")
    # no commit, connection left open: the schema's DROP waits for this transaction's lock
    assert False
