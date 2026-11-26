"""Behavioral acceptance checks against an isolated, real SQLite database."""

import csv
import io
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from conftest import headers


def get_json(client, path, actor="alice", **params):
    response = client.get(path, headers=headers(actor), params=params)
    assert response.status_code == 200, response.text
    return response.json()


def courses(client, actor="alice"):
    return get_json(client, "/api/courses", actor)


def course(client, actor="alice", title="Safety 101"):
    return next(item for item in courses(client, actor) if item["title"] == title)


def certificates(client, actor="alice", **params):
    return get_json(client, "/api/certificates", actor, page_size=100, **params)["items"]


def issue(client, course_id, key, actor="alice", payload=None):
    return client.post(
        f"/api/courses/{course_id}/issue",
        headers=headers(actor, key),
        json={} if payload is None else payload,
    )


def csv_rows(response):
    assert response.status_code == 200, response.text
    assert "text/csv" in response.headers["content-type"]
    assert "attachment" in response.headers.get("content-disposition", "")
    return list(csv.DictReader(io.StringIO(response.content.decode("utf-8-sig"))))


def database_counts(path):
    with closing(sqlite3.connect(path)) as conn, conn:
        return {
            name: conn.execute(f"SELECT count(*) FROM {name}").fetchone()[0]
            for name in ("certificates", "operations", "audit_events")
        }


def test_demo_data_has_mirrored_names_and_all_learning_states(client):
    actors = get_json(client, "/api/actors")
    by_id = {actor["id"]: actor for actor in actors}
    assert by_id["alice"]["email"] == "alice@east.test"
    assert by_id["bob"]["email"] == "bob@west.test"
    assert by_id["alice"]["timezone"] == "Australia/Sydney"
    assert by_id["bob"]["timezone"] == "Australia/Perth"
    east = get_json(client, "/api/learners")
    west = get_json(client, "/api/learners", "bob")
    assert len(east) >= 6 and len(west) >= 6
    assert {item["name"] for item in east} == {item["name"] for item in west}
    assert "Alex Lee" in {item["name"] for item in east}
    assert {item["id"] for item in east}.isdisjoint(item["id"] for item in west)
    assert {item["title"] for item in courses(client)} == {
        item["title"] for item in courses(client, "bob")
    }
    for actor in ("alice", "bob"):
        enrollments = get_json(client, "/api/enrollments", actor)
        assert {item["status"] for item in enrollments} >= {
            "completed", "in_progress", "not_started"
        }
        assert {item["certificate_status"] for item in enrollments} >= {"active", "revoked"}
        assert any(item["status"] == "completed" and not item["certificate_id"] for item in enrollments)


def test_a1_every_read_and_write_is_scoped_without_side_effects(app_db):
    client, path = app_db
    east_course = course(client)
    east_certificate = certificates(client)[0]
    east_ids = {item["id"] for item in certificates(client)}
    west_ids = {item["id"] for item in certificates(client, "bob")}
    assert east_ids.isdisjoint(west_ids)
    counts_before = database_counts(path)
    west_before = get_json(client, "/api/overview", "bob")
    for suffix in ("", "/revoke"):
        url = f"/api/certificates/{east_certificate['id']}{suffix}"
        response = (
            client.post(url, headers=headers("bob"), json={}) if suffix
            else client.get(url, headers=headers("bob"))
        )
        assert response.status_code == 404, response.text
    response = issue(client, east_course["id"], "forbidden", actor="bob")
    assert response.status_code == 404, response.text
    # A tenant query parameter cannot override the actor context.
    spoofed = certificates(client, "bob", tenant_id="east")
    assert {item["id"] for item in spoofed} == west_ids
    for endpoint in ("/api/certificates", "/api/enrollments"):
        response = client.get(endpoint, headers=headers("bob"), params={"course_id": east_course["id"]})
        if response.status_code == 200:
            body = response.json()
            assert (body["items"] if isinstance(body, dict) else body) == []
        else:
            assert response.status_code == 404
    response = client.get(
        "/api/certificates/export.csv", headers=headers("bob"),
        params={"course_id": east_course["id"]},
    )
    if response.status_code == 200:
        assert csv_rows(response) == []
    else:
        assert response.status_code == 404
    west_serials = {item["serial_number"] for item in certificates(client, "bob")}
    exported = csv_rows(client.get("/api/certificates/export.csv", headers=headers("bob")))
    assert {item["serial_number"] for item in exported} == west_serials
    assert database_counts(path) == counts_before
    assert get_json(client, "/api/overview", "bob") == west_before


@pytest.mark.parametrize("actor", [None, "unknown", "alice@east.test"])
def test_missing_and_unrecognized_actor_is_rejected(client, actor):
    response = client.get("/api/certificates", headers={} if actor is None else headers(actor))
    assert response.status_code in (401, 403), response.text
    assert isinstance(response.json()["detail"], str)


def test_a2_sequential_retry_persists_result_across_app_restart(app_db):
    from backend.main import create_app

    client, path = app_db
    course_id = course(client)["id"]
    before = database_counts(path)
    first = issue(client, course_id, "persistent-key")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["issued"] > 0
    second = issue(client, course_id, "persistent-key")
    assert second.status_code == 200 and second.json() == body
    after = database_counts(path)
    assert after["operations"] == before["operations"] + 1
    assert after["certificates"] == before["certificates"] + body["issued"]
    assert after["audit_events"] == before["audit_events"] + body["issued"]
    with TestClient(create_app(str(path))) as restarted:
        replay = issue(restarted, course_id, "persistent-key")
        assert replay.status_code == 200 and replay.json() == body
    assert database_counts(path) == after


def test_a2_concurrent_retries_share_one_operation_and_exactly_one_audit(app_db):
    client, path = app_db
    course_id = course(client)["id"]
    before = database_counts(path)
    barrier = Barrier(6)

    def submit(_):
        barrier.wait(timeout=10)
        return issue(client, course_id, "parallel-key")

    with ThreadPoolExecutor(max_workers=6) as pool:
        responses = list(pool.map(submit, range(6)))
    assert all(response.status_code == 200 for response in responses), [response.text for response in responses]
    body = responses[0].json()
    assert all(response.json() == body for response in responses)
    assert body["issued"] > 0
    after = database_counts(path)
    assert after["operations"] == before["operations"] + 1
    assert after["certificates"] == before["certificates"] + body["issued"]
    assert after["audit_events"] == before["audit_events"] + body["issued"]
    for outcome in body["outcomes"]:
        if outcome["status"] == "issued":
            detail = get_json(client, f"/api/certificates/{outcome['certificate_id']}")
            assert len(detail["audits"]) == 1


def test_different_keys_cannot_duplicate_a_certificate(app_db):
    client, path = app_db
    course_id = course(client)["id"]
    first = issue(client, course_id, "one").json()
    before = database_counts(path)
    second = issue(client, course_id, "two")
    assert second.status_code == 200, second.text
    assert first["issued"] > 0 and second.json()["issued"] == 0
    after = database_counts(path)
    assert after["certificates"] == before["certificates"]
    assert after["audit_events"] == before["audit_events"]


def test_a3_key_payload_or_course_misuse_returns_409_and_preserves_original(app_db):
    client, path = app_db
    course_ids = [item["id"] for item in courses(client)]
    first = issue(client, course_ids[0], "bound-key", payload={"note": "original", "extra": 1})
    assert first.status_code == 200, first.text
    before = database_counts(path)
    changed_course = issue(client, course_ids[1], "bound-key", payload={"note": "original", "extra": 1})
    changed_payload = issue(client, course_ids[0], "bound-key", payload={"note": "changed", "extra": 1})
    assert changed_course.status_code == changed_payload.status_code == 409
    reordered = issue(client, course_ids[0], "bound-key", payload={"extra": 1, "note": "original"})
    assert reordered.status_code == 200 and reordered.json() == first.json()
    assert database_counts(path) == before


def test_a4_each_enrollment_gets_a_truthful_outcome(client):
    course_id = course(client)["id"]
    initial = get_json(client, "/api/enrollments", course_id=course_id)
    expected_eligible = {
        item["learner_id"] for item in initial
        if item["status"] == "completed" and item["certificate_id"] is None
    }
    response = issue(client, course_id, "eligibility")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["status"] == "completed"
    assert {item["learner_id"] for item in result["outcomes"]} == {item["learner_id"] for item in initial}
    assert len(result["outcomes"]) == len(initial)
    assert {item["learner_id"] for item in result["outcomes"] if item["status"] == "issued"} == expected_eligible
    assert result["issued"] == len(expected_eligible)
    assert result["skipped"] == len(initial) - len(expected_eligible)
    assert result["failed"] == 0
    for item in result["outcomes"]:
        if item["status"] == "skipped":
            assert item["reason"]


@pytest.mark.parametrize("actor,local,date", [
    ("alice", "2026-01-11 00:30", "2026-01-11"),
    ("bob", "2026-01-10 21:30", "2026-01-10"),
])
def test_a5_iana_time_zone_controls_detail_date_and_csv(client, actor, local, date):
    fixed = [item for item in certificates(client, actor) if item["issued_at"].startswith("2026-01-10T13:30:00")]
    assert fixed, "The prescribed UTC boundary example must be seeded in both tenants."
    for item in fixed:
        assert item["issued_local"] == local
        assert item["issued_date"] == date
        detail = get_json(client, f"/api/certificates/{item['id']}", actor)
        assert detail["issued_local"] == local
        exported = csv_rows(client.get(
            "/api/certificates/export.csv", headers=headers(actor), params={"q": item["serial_number"]},
        ))
        assert len(exported) == 1 and exported[0]["issued_date"] == date


@pytest.mark.parametrize("sort", ["learner_name", "course_title", "serial_number", "issued_date"])
@pytest.mark.parametrize("direction", ["asc", "desc"])
def test_a6_csv_matches_full_filtered_sorted_list_and_is_repeatable(client, sort, direction):
    for item in courses(client):
        result = issue(client, item["id"], f"seed-{item['id']}")
        assert result.status_code == 200
    params = {"q": "Lee", "sort": sort, "direction": direction}
    first_page = get_json(client, "/api/certificates", page=1, page_size=1, **params)
    expected = []
    for page in range(1, first_page["total"] + 1):
        expected.extend(get_json(client, "/api/certificates", page=page, page_size=1, **params)["items"])
    responses = [client.get("/api/certificates/export.csv", headers=headers(), params=params) for _ in range(2)]
    rows = csv_rows(responses[0])
    assert responses[0].content == responses[1].content
    assert len(rows) == first_page["total"] > 1
    assert [item["serial_number"] for item in rows] == [item["serial_number"] for item in expected]
    assert [item["issued_date"] for item in rows] == [item["issued_date"] for item in expected]
    expected_keys = [item[sort] for item in expected]
    assert expected_keys == sorted(expected_keys, reverse=direction == "desc")


def test_csv_preserves_status_course_filters_and_empty_results(client):
    selected = next(item for item in certificates(client) if item["status"] == "revoked")
    params = {"status": "revoked", "course_id": selected["course_id"], "sort": "serial_number", "direction": "asc"}
    expected = certificates(client, **params)
    rows = csv_rows(client.get("/api/certificates/export.csv", headers=headers(), params=params))
    assert [item["serial_number"] for item in rows] == [item["serial_number"] for item in expected]
    assert csv_rows(client.get("/api/certificates/export.csv", headers=headers(), params={"q": "no-such-learner-9e12"})) == []


def test_a7_repeated_and_concurrent_revocation_has_one_audit(app_db):
    client, path = app_db
    certificate = next(item for item in certificates(client) if item["status"] == "active")
    url = f"/api/certificates/{certificate['id']}"
    prior_detail = get_json(client, url)
    before = database_counts(path)
    barrier = Barrier(4)

    def revoke(_):
        barrier.wait(timeout=10)
        return client.post(url + "/revoke", headers=headers(), json={})

    with ThreadPoolExecutor(max_workers=4) as pool:
        responses = list(pool.map(revoke, range(4)))
    assert all(response.status_code == 200 for response in responses)
    assert all(response.json()["status"] == "revoked" for response in responses)
    assert len({response.json()["revoked_at"] for response in responses}) == 1
    repeat = client.post(url + "/revoke", headers=headers(), json={})
    assert repeat.status_code == 200 and repeat.json()["revoked_at"] == responses[0].json()["revoked_at"]
    after = database_counts(path)
    assert after["certificates"] == before["certificates"]
    assert after["audit_events"] == before["audit_events"] + 1
    detail = get_json(client, url)
    assert len(detail["audits"]) == len(prior_detail["audits"]) + 1


@pytest.mark.parametrize("params", [
    {"sort": "serial_number; DROP TABLE certificates"},
    {"direction": "sideways"}, {"page": 0}, {"page_size": 0}, {"status": "unknown"},
])
def test_invalid_query_is_rejected(client, params):
    response = client.get("/api/certificates", headers=headers(), params=params)
    assert response.status_code in (400, 422), response.text


def test_search_does_not_turn_input_into_sql(client):
    result = get_json(client, "/api/certificates", q="' OR 1=1 --")
    assert result["items"] == [] and result["total"] == 0


def test_same_idempotency_key_is_independent_between_tenants(client):
    east = issue(client, course(client)["id"], "shared-key")
    west = issue(client, course(client, "bob")["id"], "shared-key", actor="bob")
    assert east.status_code == west.status_code == 200
    assert east.json()["operation_id"] != west.json()["operation_id"]
    assert east.json()["issued"] > 0 and west.json()["issued"] > 0


def test_relational_constraints_reject_cross_tenant_links(app_db):
    from backend.db import connect

    _, path = app_db
    db = connect(path)
    try:
        assert db.execute("PRAGMA foreign_keys").fetchone()[0] == 1
        for table, column, value, row_id in [
            ("enrollments", "learner_id", "west-learner-1", "east-enrollment-safety-1"),
            ("enrollments", "course_id", "west-course-safety", "east-enrollment-safety-1"),
            ("certificates", "learner_id", "east-learner-2", "east-certificate-safety-1"),
            ("certificates", "tenant_id", "west", "east-certificate-safety-1"),
            ("audit_events", "actor_id", "bob", "east-certificate-safety-1-issued"),
        ]:
            with pytest.raises(sqlite3.IntegrityError):
                db.execute(f"UPDATE {table} SET {column}=? WHERE id=?", (value, row_id))
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []
    finally:
        db.close()


def test_audit_failure_rolls_back_that_learner_and_replays_failed_outcome(app_db):
    client, path = app_db
    before = database_counts(path)
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript("""
            CREATE TRIGGER acceptance_fail_issue_audit BEFORE INSERT ON audit_events
            WHEN NEW.action='issued' AND NEW.certificate_id IN (
                SELECT id FROM certificates WHERE learner_id='east-learner-2'
            )
            BEGIN SELECT RAISE(ABORT, 'Acceptance injected audit failure'); END;
        """)
    response = issue(client, course(client)["id"], "audit-failure")
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["failed"] == 1 and result["issued"] == 1
    failed = next(item for item in result["outcomes"] if item["learner_id"] == "east-learner-2")
    assert failed["status"] == "failed" and failed["reason"]
    after = database_counts(path)
    assert after["certificates"] == before["certificates"] + 1
    assert after["audit_events"] == before["audit_events"] + 1
    with closing(sqlite3.connect(path)) as db, db:
        assert db.execute(
            "SELECT count(*) FROM certificates WHERE learner_id=? AND course_id=?",
            ("east-learner-2", "east-course-safety"),
        ).fetchone()[0] == 0
        db.execute("DROP TRIGGER acceptance_fail_issue_audit")
    retry = issue(client, course(client)["id"], "audit-failure")
    assert retry.status_code == 200 and retry.json() == result
    assert database_counts(path) == after


def test_revocation_failure_rolls_back_status_and_audit(app_db):
    client, path = app_db
    certificate_id = "east-certificate-safety-1"
    before = database_counts(path)
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript("""
            CREATE TRIGGER acceptance_fail_revoke_audit BEFORE INSERT ON audit_events
            WHEN NEW.action='revoked'
            BEGIN SELECT RAISE(ABORT, 'Acceptance injected revocation failure'); END;
        """)
    with TestClient(client.app, raise_server_exceptions=False) as errors_client:
        response = errors_client.post(
            f"/api/certificates/{certificate_id}/revoke", headers=headers(), json={},
        )
    assert response.status_code >= 500
    detail = get_json(client, f"/api/certificates/{certificate_id}")
    assert detail["status"] == "active" and detail["revoked_at"] is None
    assert database_counts(path) == before


def test_operation_failure_rolls_back_all_certificates_and_audits(app_db):
    client, path = app_db
    before = database_counts(path)
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript("""
            CREATE TRIGGER acceptance_fail_operation BEFORE UPDATE ON operations
            WHEN NEW.status='completed'
            BEGIN SELECT RAISE(ABORT, 'Acceptance injected operation failure'); END;
        """)
    with TestClient(client.app, raise_server_exceptions=False) as errors_client:
        response = issue(errors_client, "east-course-safety", "transaction-failure")
    assert response.status_code >= 500
    assert database_counts(path) == before


def test_csv_quotes_names_and_neutralizes_spreadsheet_formulas(app_db):
    client, path = app_db
    with closing(sqlite3.connect(path)) as db, db:
        db.execute("UPDATE learners SET name=? WHERE id=?", ('=HYPERLINK("unsafe")', "east-learner-1"))
        db.execute("UPDATE courses SET title=? WHERE id=?", ('Safety, "101"\nSecond line', "east-course-safety"))
    rows = csv_rows(client.get("/api/certificates/export.csv", headers=headers()))
    target = next(row for row in rows if row["serial_number"] == "OCE-EAST-2026-010001")
    assert target["learner_name"].startswith("'=HYPERLINK")
    assert target["course_title"] == 'Safety, "101"\nSecond line'
