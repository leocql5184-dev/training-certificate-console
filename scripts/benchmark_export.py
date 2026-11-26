"""A6: real HTTP streaming export against a disposable 100,000-row database.

Run from the repository root: python scripts/benchmark_export.py
The application's default database is never modified.
"""

from __future__ import annotations

import argparse
import csv
from contextlib import closing
import hashlib
import json
import os
import re
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

import httpx


ROOT = Path(__file__).resolve().parents[1]
HEADERS = {"X-Actor-Id": "alice"}


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def expected_rows(db_path: Path, query: str) -> list[dict]:
    with closing(sqlite3.connect(db_path)) as db:
        db.row_factory = sqlite3.Row
        rows = db.execute(
            """SELECT l.name AS learner_name, co.title AS course_title,
                      c.serial_number, c.issued_date
               FROM certificates c
               JOIN learners l ON l.tenant_id=c.tenant_id AND l.id=c.learner_id
               JOIN courses co ON co.tenant_id=c.tenant_id AND co.id=c.course_id
               WHERE c.tenant_id='east' AND (l.name LIKE ? OR c.serial_number LIKE ?)
               ORDER BY l.name ASC, c.id ASC""",
            (f"%{query}%", f"%{query}%"),
        ).fetchall()
        return [dict(row) for row in rows]


def start_server(port, env, server_log, creationflags):
    return subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1",
         "--port", str(port), "--log-level", "warning"],
        cwd=ROOT, env=env, stdout=server_log, stderr=subprocess.STDOUT,
        creationflags=creationflags,
    )


def wait_ready(client, process, log_path):
    deadline = time.monotonic() + 30
    while True:
        if process.poll() is not None:
            raise RuntimeError(f"Server exited: {log_path.read_text(encoding='utf-8')}")
        try:
            if client.get("/api/health", timeout=1).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        if time.monotonic() > deadline:
            raise RuntimeError("Temporary benchmark server did not become ready. " + log_path.read_text(encoding="utf-8"))
        time.sleep(0.1)


def stop_server(process, creationflags):
    if os.name == "nt" and process.poll() is None:
        # venv's Windows redirector can own another Python process.
        # Stop only this benchmark's process tree before removing its DB.
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T", "/F"],
            capture_output=True, creationflags=creationflags,
        )
    elif process.poll() is None:
        process.kill()
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=10)


def interrupt_export(client, process, creationflags, query, expected):
    params = {"q": query, "sort": "learner_name", "direction": "asc"}
    with client.stream("GET", "/api/certificates/export.csv", headers=HEADERS, params=params) as partial:
        partial.raise_for_status()
        lines = partial.iter_lines()
        assert next(lines).lstrip("\ufeff").split(",") == list(expected[0])
        reader = csv.DictReader(lines, fieldnames=list(expected[0]))
        for offset in range(len(expected) // 2):
            assert next(reader) == expected[offset]
        stop_server(process, creationflags)
    try:
        client.get("/api/health", timeout=2)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pass
    else:
        raise AssertionError("Server still reachable after interruption")


def check_recovery(client, db_path, count, query):
    with closing(sqlite3.connect(db_path)) as db:
        assert db.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert not db.execute("PRAGMA foreign_key_check").fetchall()
    home = client.get("/")
    home.raise_for_status()
    assert 'id="root"' in home.text
    assets = re.findall(r'(?:src|href)="(/assets/[^"]+)"', home.text)
    assert assets
    for asset in assets:
        client.get(asset).raise_for_status()
    for actor, total in (("alice", count), ("bob", min(count, 1000))):
        listing = client.get("/api/certificates", headers={"X-Actor-Id": actor}, params={"q": query})
        listing.raise_for_status()
        assert listing.json()["total"] == total
    issued = client.post("/api/courses/east-course-safety/issue",
        headers={**HEADERS, "Idempotency-Key": "after-restart"}, json={})
    issued.raise_for_status()
    assert issued.json()["issued"] == 2
    certificate = next(item["certificate_id"] for item in issued.json()["outcomes"] if item["status"] == "issued")
    detail = f"/api/certificates/{certificate}"
    assert client.get(detail, headers={"X-Actor-Id": "bob"}).status_code == 404
    assert client.post(detail + "/revoke", headers=HEADERS).json()["status"] == "revoked"
    assert client.get(detail, headers=HEADERS).json()["status"] == "revoked"


def run_benchmark(count: int) -> dict:
    with tempfile.TemporaryDirectory(prefix="ocean-export-benchmark-") as temp:
        temp_path = Path(temp)
        db_path = temp_path / "benchmark.sqlite3"
        creationflags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        env = {**os.environ, "CERT_DB_PATH": str(db_path), "PYTHONUTF8": "1"}
        for tenant, tenant_count in (("east", count), ("west", min(count, 1000))):
            seeded = subprocess.run(
                [sys.executable, "-m", "backend.seed_large", "--count", str(tenant_count),
                 "--tenant", tenant, "--db", str(db_path)],
                cwd=ROOT, capture_output=True, text=True, encoding="utf-8", check=True,
                creationflags=creationflags, env=env,
            )
            if seeded.stdout.strip():
                print(seeded.stdout.strip(), file=sys.stderr)
        query = "Load Learner"
        expected = expected_rows(db_path, query)
        if len(expected) != count:
            raise AssertionError(f"Expected exactly {count} workload rows; found {len(expected)}.")
        if len({row["learner_name"] for row in expected}) == count:
            raise AssertionError("Workload must contain duplicate sort keys.")
        port = free_port()
        origin = f"http://127.0.0.1:{port}"
        log_path = temp_path / "server.log"
        with log_path.open("w", encoding="utf-8") as server_log:
            process = start_server(port, env, server_log, creationflags)
            try:
                with httpx.Client(base_url=origin, timeout=60, trust_env=False) as client:
                    wait_ready(client, process, log_path)
                    runs = []
                    list_result = None
                    for iteration in (1, 2, 3):
                        if iteration == 3:
                            interrupt_export(client, process, creationflags, query, expected)
                            process = start_server(port, env, server_log, creationflags)
                            wait_ready(client, process, log_path)
                            check_recovery(client, db_path, count, query)
                        destination = temp_path / f"export-{iteration}.csv"
                        started = time.monotonic()
                        digest = hashlib.sha256()
                        byte_count = 0
                        with client.stream(
                            "GET", "/api/certificates/export.csv", headers=HEADERS,
                            params={"q": query, "sort": "learner_name", "direction": "asc"},
                        ) as response:
                            response.raise_for_status()
                            with destination.open("wb") as output:
                                for chunk in response.iter_bytes():
                                    output.write(chunk)
                                    digest.update(chunk)
                                    byte_count += len(chunk)
                                    if iteration == 1 and list_result is None:
                                        # Leave the first response open while another connection asks for the list.
                                        list_started = time.monotonic()
                                        with httpx.Client(base_url=origin, timeout=10, trust_env=False) as concurrent:
                                            listing = concurrent.get("/api/certificates", headers=HEADERS, params={"q": query, "page_size": 10})
                                        listing.raise_for_status()
                                        body = listing.json()
                                        assert body["total"] == count and len(body["items"]) == 10
                                        list_result = {
                                            "status": listing.status_code,
                                            "duration_seconds": round(time.monotonic() - list_started, 4),
                                            "started_after_export_seconds": round(list_started - started, 4),
                                            "response_completed_while_export_open": True,
                                        }
                        elapsed = time.monotonic() - started
                        assert elapsed <= 60, f"Export {iteration} took {elapsed:.2f}s (limit: 60s)."
                        with destination.open(encoding="utf-8-sig", newline="") as stream:
                            actual = list(csv.DictReader(stream))
                        assert actual == expected, f"Export {iteration} differs from independently queried rows/order."
                        runs.append({
                            "iteration": iteration,
                            "duration_seconds": round(elapsed, 4),
                            "matching_rows": len(actual),
                            "bytes": byte_count,
                            "sha256": digest.hexdigest(),
                        })
                    assert len({run["sha256"] for run in runs}) == 1, "Repeated export order/content is unstable."
                    return {"status": "passed", "east_generated_rows": count,
                            "west_generated_rows": min(count, 1000), "runs": runs,
                            "interrupted_after_rows": count // 2, "restarted_on_same_database": True,
                            "concurrent_list": list_result, "default_demo_database_modified": False}
            finally:
                stop_server(process, creationflags)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=100_000)
    args = parser.parse_args()
    if args.count < 1000:
        parser.error("--count must be at least 1000 to exercise duplicate sort keys.")
    print(json.dumps(run_benchmark(args.count), ensure_ascii=False, indent=2))
