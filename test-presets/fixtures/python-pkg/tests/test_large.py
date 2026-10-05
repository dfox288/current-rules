import subprocess
import sys
import urllib.request

import pytest


@pytest.mark.large
def test_serves_a_directory_on_loopback(tmp_path):
    (tmp_path / "hello.txt").write_text("hi")
    port_probe = subprocess.run(
        [sys.executable, "-c", "import socket;s=socket.socket();s.bind(('127.0.0.1',0));print(s.getsockname()[1])"],
        capture_output=True, text=True, check=True,
    )
    port = int(port_probe.stdout)
    server = subprocess.Popen(
        [sys.executable, "-m", "http.server", str(port), "--bind", "127.0.0.1", "--directory", str(tmp_path)],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        for _ in range(50):
            try:
                body = urllib.request.urlopen(f"http://127.0.0.1:{port}/hello.txt", timeout=1).read()
                break
            except OSError:
                import time
                time.sleep(0.1)
        assert body == b"hi"
    finally:
        server.terminate()
        server.wait()
