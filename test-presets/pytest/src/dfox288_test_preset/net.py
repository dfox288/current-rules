"""A free TCP port for a test's own server (testing.md, "What a test may fake").

Prefer to let the server bind port 0 and read the port it got. `free_port` is for a server that must be told its
port (a subprocess, a config file). The port is free when this returns, not afterwards: another process may take it
before the server binds, so a test that cannot bind port 0 retries on `EADDRINUSE`.

A small test cannot open a socket, so this raises there: mark the test `medium`.
"""

import socket


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]
