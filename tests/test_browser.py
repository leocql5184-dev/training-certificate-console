"""Run the built React app and real API together on a disposable large SQLite database."""
from pathlib import Path
import shutil
import socket
import subprocess
from threading import Thread
import time

import pytest
import uvicorn

from backend.main import create_app
from backend.seed_large import generate


@pytest.fixture(scope="module")
def browser_site(tmp_path_factory):
    path = tmp_path_factory.mktemp("browser-site") / "acceptance.db"
    generate(100_000, "east", str(path))
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(create_app(path), log_level="warning"))
        thread = Thread(target=server.run, kwargs={"sockets": [listener]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 15
            while not server.started:
                assert thread.is_alive() and time.monotonic() < deadline, "Browser test server failed to start"
                time.sleep(0.05)
            yield f"http://127.0.0.1:{port}"
        finally:
            server.should_exit = True
            thread.join(timeout=15)
            assert not thread.is_alive()


@pytest.mark.parametrize("scenario", ["directory", "mutations"])
def test_browser(browser_site, scenario):
    frontend = Path(__file__).resolve().parents[1] / "frontend"
    subprocess.run([shutil.which("node") or "node", "tests/browser.mjs", browser_site, scenario],
                   cwd=frontend, check=True, timeout=90)
