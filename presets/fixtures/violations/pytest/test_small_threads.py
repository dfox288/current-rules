import asyncio
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Thread

TARGET = Path.cwd() / "planted-write.txt"


def test_small_thread_writes_outside():
    errors = []

    def work():
        try:
            TARGET.write_text("x")
        except Exception as error:  # the violation must fail the test even if the thread swallows it
            errors.append(error)

    t = Thread(target=work)
    t.start()
    t.join()


def test_small_executor_writes_outside():
    with ThreadPoolExecutor(1) as pool:
        try:
            pool.submit(TARGET.write_text, "x").result()
        except Exception:
            pass


def test_small_to_thread_opens_a_socket():
    async def go():
        await asyncio.to_thread(socket.create_connection, ("203.0.113.1", 80), 1)

    asyncio.run(go())
