import socket

import pytest
from dfox288_test_preset.net import free_port


@pytest.mark.medium
def test_free_port_is_one_a_server_can_bind_now():
    port = free_port()
    assert 1024 <= port <= 65535
    with socket.socket() as server:
        server.bind(("127.0.0.1", port))


@pytest.mark.medium
def test_free_port_is_not_one_that_is_taken():
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen()
        assert free_port() != server.getsockname()[1]

