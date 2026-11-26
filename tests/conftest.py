from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


@pytest.fixture
def app_db(tmp_path):
    from backend.main import create_app

    path = tmp_path / "acceptance.sqlite3"
    app = create_app(str(path))
    with TestClient(app) as client:
        yield client, path


@pytest.fixture
def client(app_db):
    return app_db[0]


def headers(actor="alice", key=None):
    result = {"X-Actor-Id": actor}
    if key is not None:
        result["Idempotency-Key"] = key
    return result
