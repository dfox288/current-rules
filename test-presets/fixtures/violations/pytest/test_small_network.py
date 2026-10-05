import socket
import urllib.request


def test_small_opens_a_socket_connection():
    with socket.create_connection(("203.0.113.1", 80), timeout=1):
        pass


def test_small_opens_a_socket_urllib():
    urllib.request.urlopen("http://203.0.113.1/", timeout=1)
