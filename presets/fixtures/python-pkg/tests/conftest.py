from urllib.parse import unquote, urlsplit

import pg8000.dbapi
import pytest
from dfox288_test_preset.db import open_test_schema


def connect(url: str):
    parts = urlsplit(url)
    return pg8000.dbapi.connect(
        user=unquote(parts.username or ""),
        password=unquote(parts.password or ""),
        host=parts.hostname,
        port=parts.port or 5432,
        database=parts.path.lstrip("/"),
    )


@pytest.fixture
def schema():
    with open_test_schema(connect) as s:
        yield s
