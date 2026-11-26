"""SQLite schema, isolated connections, and deterministic demo data."""

from __future__ import annotations

import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]


def database_path(path: str | Path | None = None) -> str:
    return str(path or os.environ.get("CERT_DB_PATH") or ROOT / "data" / "certificates.db")


def connect(path: str | Path | None = None) -> sqlite3.Connection:
    target = database_path(path)
    if target != ":memory:":
        Path(target).parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(target, timeout=30, isolation_level=None, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys=ON")
    connection.execute("PRAGMA busy_timeout=30000")
    return connection


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z")


def local_time(timestamp: str, timezone_name: str) -> str:
    return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).astimezone(ZoneInfo(timezone_name)).strftime("%Y-%m-%d %H:%M")


SCHEMA = """
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS learners (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    UNIQUE(tenant_id, id),
    UNIQUE(tenant_id, email)
);
CREATE TABLE IF NOT EXISTS courses (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    UNIQUE(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS enrollments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    learner_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('completed','in_progress','not_started')),
    progress INTEGER NOT NULL CHECK(progress BETWEEN 0 AND 100),
    completed_at TEXT,
    UNIQUE(tenant_id, id),
    UNIQUE(tenant_id, learner_id, course_id),
    UNIQUE(tenant_id, id, learner_id, course_id),
    CHECK((status='completed' AND progress=100 AND completed_at IS NOT NULL) OR
          (status='in_progress' AND progress BETWEEN 1 AND 99 AND completed_at IS NULL) OR
          (status='not_started' AND progress=0 AND completed_at IS NULL)),
    FOREIGN KEY(tenant_id, learner_id) REFERENCES learners(tenant_id, id),
    FOREIGN KEY(tenant_id, course_id) REFERENCES courses(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS operations (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    actor_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('processing','completed')),
    result_json TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(tenant_id, id),
    UNIQUE(tenant_id, idempotency_key),
    FOREIGN KEY(tenant_id, actor_id) REFERENCES admins(tenant_id, id),
    FOREIGN KEY(tenant_id, course_id) REFERENCES courses(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    enrollment_id TEXT NOT NULL,
    learner_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    operation_id TEXT,
    serial_number TEXT NOT NULL UNIQUE,
    issued_at TEXT NOT NULL,
    issued_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','revoked')),
    revoked_at TEXT,
    UNIQUE(tenant_id, id),
    UNIQUE(tenant_id, enrollment_id),
    UNIQUE(tenant_id, learner_id, course_id),
    CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL)),
    FOREIGN KEY(tenant_id, enrollment_id, learner_id, course_id)
        REFERENCES enrollments(tenant_id, id, learner_id, course_id),
    FOREIGN KEY(tenant_id, learner_id) REFERENCES learners(tenant_id, id),
    FOREIGN KEY(tenant_id, course_id) REFERENCES courses(tenant_id, id),
    FOREIGN KEY(tenant_id, operation_id) REFERENCES operations(tenant_id, id)
);
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id),
    actor_id TEXT NOT NULL,
    certificate_id TEXT NOT NULL,
    operation_id TEXT,
    action TEXT NOT NULL CHECK(action IN ('issued','revoked')),
    created_at TEXT NOT NULL,
    detail TEXT NOT NULL,
    UNIQUE(tenant_id, certificate_id, action),
    FOREIGN KEY(tenant_id, actor_id) REFERENCES admins(tenant_id, id),
    FOREIGN KEY(tenant_id, certificate_id) REFERENCES certificates(tenant_id, id),
    FOREIGN KEY(tenant_id, operation_id) REFERENCES operations(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_learners_tenant_name ON learners(tenant_id, name, id);
CREATE INDEX IF NOT EXISTS idx_courses_tenant_title ON courses(tenant_id, title, id);
CREATE INDEX IF NOT EXISTS idx_enrollment_course ON enrollments(tenant_id, course_id, learner_id);
CREATE INDEX IF NOT EXISTS idx_cert_date ON certificates(tenant_id, issued_date, id);
CREATE INDEX IF NOT EXISTS idx_cert_serial ON certificates(tenant_id, serial_number, id);
CREATE INDEX IF NOT EXISTS idx_cert_status_date ON certificates(tenant_id, status, issued_date, id);
CREATE INDEX IF NOT EXISTS idx_cert_course ON certificates(tenant_id, course_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_events(tenant_id, created_at DESC, id);
"""


def init_db(path: str | Path | None = None) -> None:
    db = connect(path)
    try:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript(SCHEMA)
        db.execute("BEGIN IMMEDIATE")
        seed_demo(db)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def seed_demo(db: sqlite3.Connection) -> None:
    names = ["Alex Lee", "Jordan Chen", "Morgan Wang", "Taylor Lin", "Casey Wu", "Riley Zhang"]
    courses = [
        ("safety", "Safety 101", "掌握工作场所安全规范、风险识别和应急处理。"),
        ("privacy", "Data Privacy", "理解个人信息保护、数据分类与安全处理原则。"),
        ("workplace", "Workplace Essentials", "建立团队协作、职业沟通和日常工作规范。"),
    ]
    # Completed eligible, incomplete, not started, already certified, revoked.
    states = [
        [("completed", 100), ("completed", 100), ("in_progress", 65), ("not_started", 0), ("completed", 100), ("completed", 100)],
        [("completed", 100), ("completed", 100), ("completed", 100), ("in_progress", 40), ("completed", 100), ("not_started", 0)],
        [("completed", 100), ("in_progress", 80), ("completed", 100), ("completed", 100), ("not_started", 0), ("in_progress", 25)],
    ]
    seeded = {(0, 0): "active", (0, 4): "revoked", (1, 1): "active", (1, 2): "active", (2, 0): "active", (2, 2): "revoked", (2, 3): "active"}
    for tenant, label, tz, actor, admin_name in [
        ("east", "East", "Australia/Sydney", "alice", "Alice"),
        ("west", "West", "Australia/Perth", "bob", "Bob"),
    ]:
        db.execute("INSERT OR IGNORE INTO tenants VALUES (?,?,?)", (tenant, label, tz))
        db.execute("INSERT OR IGNORE INTO admins VALUES (?,?,?,?)", (actor, tenant, admin_name, f"{actor}@{tenant}.test"))
        for index, name in enumerate(names, 1):
            db.execute("INSERT OR IGNORE INTO learners VALUES (?,?,?,?)", (f"{tenant}-learner-{index}", tenant, name, f"{name.lower().replace(' ', '.')}@{tenant}.test"))
        for ci, (slug, title, description) in enumerate(courses):
            course_id = f"{tenant}-course-{slug}"
            db.execute("INSERT OR IGNORE INTO courses VALUES (?,?,?,?)", (course_id, tenant, title, description))
            for li, (state, progress) in enumerate(states[ci]):
                learner_id = f"{tenant}-learner-{li+1}"
                enrollment_id = f"{tenant}-enrollment-{slug}-{li+1}"
                complete = "2026-01-09T05:00:00Z" if state == "completed" else None
                db.execute("INSERT OR IGNORE INTO enrollments VALUES (?,?,?,?,?,?,?)", (enrollment_id, tenant, learner_id, course_id, state, progress, complete))
                cert_status = seeded.get((ci, li))
                if cert_status is None:
                    continue
                issued_at = "2026-01-10T13:30:00Z" if ci == 0 and li == 0 else f"2026-11-{10 + ci * 3 + li:02d}T0{ci+1}:15:00Z"
                certificate_id = f"{tenant}-certificate-{slug}-{li+1}"
                revoked_at = "2026-11-25T03:00:00Z" if cert_status == "revoked" else None
                inserted = db.execute(
                    "INSERT OR IGNORE INTO certificates VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    (certificate_id, tenant, enrollment_id, learner_id, course_id, None,
                     f"OCE-{tenant.upper()}-2026-{ci+1:02d}{li+1:04d}", issued_at,
                     local_time(issued_at, tz)[:10], cert_status, revoked_at),
                ).rowcount
                if inserted:
                    db.execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)", (f"{certificate_id}-issued", tenant, actor, certificate_id, None, "issued", issued_at, "演示数据：学员完成课程，签发证书。"))
                    if revoked_at:
                        db.execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)", (f"{certificate_id}-revoked", tenant, actor, certificate_id, None, "revoked", revoked_at, "演示数据：证书已撤销，保留历史记录。"))


if __name__ == "__main__":
    init_db()
    print(f"Database ready: {database_path()}")
