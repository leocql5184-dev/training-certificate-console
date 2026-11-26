"""Opt-in deterministic load data; does not alter the default seed dataset."""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone

from .db import connect, database_path, init_db, local_time


def generate(count: int = 100_000, tenant: str = "east", db_path: str | None = None) -> int:
    if count < 1:
        raise ValueError("count must be positive")
    init_db(db_path)
    db = connect(db_path)
    inserted = 0
    try:
        record = db.execute("SELECT timezone FROM tenants WHERE id=?", (tenant,)).fetchone()
        if record is None:
            raise ValueError("Unknown tenant")
        timezone_name = record["timezone"]
        actor = db.execute("SELECT id FROM admins WHERE tenant_id=? ORDER BY id LIMIT 1", (tenant,)).fetchone()["id"]
        course_id = f"{tenant}-course-load"
        db.execute("BEGIN IMMEDIATE")
        db.execute("INSERT OR IGNORE INTO courses VALUES (?,?,?,?)", (course_id, tenant, "Export Load Test", "按需生成的导出性能验证数据，不属于默认演示数据。"))
        base = datetime(2026, 1, 10, 13, 30, tzinfo=timezone.utc)
        for index in range(1, count + 1):
            suffix = f"{index:06d}"
            learner_id = f"{tenant}-load-learner-{suffix}"
            enrollment_id = f"{tenant}-load-enrollment-{suffix}"
            certificate_id = f"{tenant}-load-cert-{suffix}"
            timestamp = (base + timedelta(minutes=index % 1440)).isoformat().replace("+00:00", "Z")
            # Repeated names, titles and dates deliberately exercise stable tie ordering.
            db.execute("INSERT OR IGNORE INTO learners VALUES (?,?,?,?)", (learner_id, tenant, f"Load Learner {index % 100:03d}", f"load-{suffix}@{tenant}.test"))
            db.execute("INSERT OR IGNORE INTO enrollments VALUES (?,?,?,?,?,?,?)", (enrollment_id, tenant, learner_id, course_id, "completed", 100, "2026-01-09T05:00:00Z"))
            created = db.execute("INSERT OR IGNORE INTO certificates VALUES (?,?,?,?,?,?,?,?,?,?,?)", (certificate_id, tenant, enrollment_id, learner_id, course_id, None, f"LOAD-{tenant.upper()}-{suffix}", timestamp, local_time(timestamp, timezone_name)[:10], "active", None)).rowcount
            if created:
                inserted += 1
                db.execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)", (f"{certificate_id}-issued", tenant, actor, certificate_id, None, "issued", timestamp, "按需生成：导出性能验证证书。"))
        db.commit()
        return inserted
    except BaseException:
        db.rollback()
        raise
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=100_000)
    parser.add_argument("--tenant", choices=["east", "west"], default="east")
    parser.add_argument("--db", default=None)
    args = parser.parse_args()
    count = generate(args.count, args.tenant, args.db)
    print(f"Added {count:,} certificates to {args.tenant} in {database_path(args.db)}")


if __name__ == "__main__":
    main()
