"""Tenant-scoped HTTP API and same-origin React application."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import logging
import sqlite3
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .db import ROOT, connect, database_path, init_db, local_time, utc_now

logger = logging.getLogger(__name__)

CERT_SELECT = """SELECT c.id, c.serial_number, c.learner_id, l.name AS learner_name,
    c.course_id, co.title AS course_title, c.issued_at, c.issued_date, c.status, c.revoked_at
    FROM certificates c
    JOIN learners l ON l.id=c.learner_id AND l.tenant_id=c.tenant_id
    JOIN courses co ON co.id=c.course_id AND co.tenant_id=c.tenant_id"""
SORTS = {"learner_name": "l.name", "course_title": "co.title", "serial_number": "c.serial_number", "issued_date": "c.issued_date"}
SortField = Literal["learner_name", "course_title", "serial_number", "issued_date"]
Direction = Literal["asc", "desc"]
CertificateStatus = Literal["", "active", "revoked"]


def like_pattern(text: str) -> str:
    return "%" + text.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def certificate_json(row: sqlite3.Row, timezone_name: str) -> dict:
    result = dict(row)
    result["issued_local"] = local_time(result["issued_at"], timezone_name)
    return result


def query_scope(tenant_id: str, q: str, status: str, course_id: str) -> tuple[str, list]:
    clauses = ["c.tenant_id=?"]
    args: list = [tenant_id]
    if q.strip():
        clauses.append("(l.name LIKE ? ESCAPE '\\' OR c.serial_number LIKE ? ESCAPE '\\')")
        args.extend([like_pattern(q), like_pattern(q)])
    if status:
        clauses.append("c.status=?")
        args.append(status)
    if course_id:
        clauses.append("c.course_id=?")
        args.append(course_id)
    return " WHERE " + " AND ".join(clauses), args


def stable_order(sort: str, direction: str) -> str:
    # Both values are validated enums; the same total ordering is used for CSV.
    return f" ORDER BY {SORTS[sort]} {direction.upper()}, c.id ASC"


def audit_json(row: sqlite3.Row, timezone_name: str) -> dict:
    result = dict(row)
    result["created_local"] = local_time(result["created_at"], timezone_name)
    return result


def create_app(db_path: str | Path | None = None) -> FastAPI:
    path = database_path(db_path)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        init_db(path)
        yield

    application = FastAPI(title="Ocean Academy Certificate API", version="1.0.0", lifespan=lifespan)
    application.state.db_path = path

    @application.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        # A consistent, readable error body also works for the frontend toast.
        messages = [".".join(str(x) for x in e["loc"]) + ": " + e["msg"] for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": "; ".join(messages)})

    @application.exception_handler(sqlite3.OperationalError)
    async def database_error(_: Request, exc: sqlite3.OperationalError):
        logger.exception("Database operation failed", exc_info=exc)
        if "locked" in str(exc).lower() or "busy" in str(exc).lower():
            return JSONResponse(status_code=503, content={"detail": "数据库忙，请使用相同幂等键重试。"}, headers={"Retry-After": "1"})
        return JSONResponse(status_code=500, content={"detail": "数据库操作失败，请稍后重试。"})

    def get_actor(x_actor_id: Annotated[str | None, Header()] = None) -> dict:
        if not x_actor_id:
            raise HTTPException(401, "请选择管理员身份（X-Actor-Id）。")
        db = connect(path)
        try:
            row = db.execute("SELECT a.*, t.name AS tenant_name, t.timezone FROM admins a JOIN tenants t ON t.id=a.tenant_id WHERE a.id=?", (x_actor_id,)).fetchone()
            if row is None:
                raise HTTPException(401, "管理员身份无效。")
            return dict(row)
        finally:
            db.close()

    def find_certificate(db: sqlite3.Connection, certificate_id: str, actor: dict) -> dict:
        row = db.execute(CERT_SELECT + " WHERE c.tenant_id=? AND c.id=?", (actor["tenant_id"], certificate_id)).fetchone()
        if row is None:
            raise HTTPException(404, "证书不存在。")
        return certificate_json(row, actor["timezone"])

    @application.get("/api/health")
    def health():
        return {"status": "ok"}

    @application.get("/api/actors")
    def actors():
        db = connect(path)
        try:
            return [dict(row) for row in db.execute("SELECT a.id,a.name,a.email,a.tenant_id,t.name AS tenant_name,t.timezone FROM admins a JOIN tenants t ON t.id=a.tenant_id ORDER BY t.name,a.id")]
        finally:
            db.close()

    @application.get("/api/overview")
    def overview(actor: dict = Depends(get_actor)):
        db = connect(path)
        tenant = actor["tenant_id"]
        try:
            db.execute("BEGIN")
            result = {name: db.execute(f"SELECT COUNT(*) FROM {name} WHERE tenant_id=?", (tenant,)).fetchone()[0] for name in ("learners", "courses", "enrollments")}
            result["completed"] = db.execute("SELECT COUNT(*) FROM enrollments WHERE tenant_id=? AND status='completed'", (tenant,)).fetchone()[0]
            result["eligible"] = db.execute("SELECT COUNT(*) FROM enrollments e WHERE e.tenant_id=? AND e.status='completed' AND NOT EXISTS (SELECT 1 FROM certificates c WHERE c.tenant_id=e.tenant_id AND c.enrollment_id=e.id)", (tenant,)).fetchone()[0]
            for state in ("active", "revoked"):
                result[f"{state}_certificates"] = db.execute("SELECT COUNT(*) FROM certificates WHERE tenant_id=? AND status=?", (tenant, state)).fetchone()[0]
            return result
        finally:
            db.close()

    @application.get("/api/courses")
    def courses(actor: dict = Depends(get_actor)):
        db = connect(path)
        try:
            return [dict(row) for row in db.execute("""SELECT co.id,co.title,co.description,
                COUNT(e.id) AS enrolled_count,
                SUM(CASE WHEN e.status='completed' THEN 1 ELSE 0 END) AS completed_count,
                SUM(CASE WHEN e.status='completed' AND c.id IS NULL THEN 1 ELSE 0 END) AS eligible_count,
                COUNT(c.id) AS certificate_count
                FROM courses co LEFT JOIN enrollments e ON e.tenant_id=co.tenant_id AND e.course_id=co.id
                LEFT JOIN certificates c ON c.tenant_id=e.tenant_id AND c.enrollment_id=e.id
                WHERE co.tenant_id=? GROUP BY co.id ORDER BY co.title,co.id""", (actor["tenant_id"],))]
        finally:
            db.close()

    @application.get("/api/learners")
    def learners(q: str = Query("", max_length=200), page: int | None = Query(None, ge=1),
                 page_size: int = Query(20, ge=1, le=100), actor: dict = Depends(get_actor)):
        db = connect(path)
        try:
            db.execute("BEGIN")
            where = "tenant_id=?"
            args = [actor["tenant_id"]]
            if q.strip():
                where += " AND (name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\')"
                args.extend([like_pattern(q), like_pattern(q)])
            selected = "SELECT id,tenant_id,name,email FROM learners WHERE " + where + " ORDER BY name,id"
            if page is not None:
                total = db.execute("SELECT COUNT(*) FROM learners WHERE " + where, args).fetchone()[0]
                selected += " LIMIT ? OFFSET ?"
                args.extend([page_size, (page - 1) * page_size])
            rows = db.execute(f"""WITH selected AS ({selected})
                SELECT l.id,l.name,l.email,COUNT(e.id) AS enrolled_count,
                       COUNT(CASE WHEN e.status='completed' THEN 1 END) AS completed_count,
                       COUNT(c.id) AS certificate_count
                FROM selected l LEFT JOIN enrollments e ON e.tenant_id=l.tenant_id AND e.learner_id=l.id
                LEFT JOIN certificates c ON c.tenant_id=e.tenant_id AND c.enrollment_id=e.id
                GROUP BY l.id ORDER BY l.name,l.id""", args)
            items = [dict(row) for row in rows]
            if page is None:
                return items
            return {"items": items, "total": total, "page": page, "page_size": page_size}
        finally:
            db.close()

    @application.get("/api/enrollments")
    def enrollments(learner_id: str = Query("", max_length=200), course_id: str = Query("", max_length=200), q: str = Query("", max_length=200), actor: dict = Depends(get_actor)):
        db = connect(path)
        try:
            args = [actor["tenant_id"], like_pattern(q), like_pattern(q)]
            where = "WHERE e.tenant_id=? AND (l.name LIKE ? ESCAPE '\\' OR co.title LIKE ? ESCAPE '\\')"
            if learner_id:
                where += " AND e.learner_id=?"
                args.append(learner_id)
            if course_id:
                where += " AND e.course_id=?"
                args.append(course_id)
            return [dict(row) for row in db.execute("""SELECT e.id,e.learner_id,l.name AS learner_name,l.email AS learner_email,
                e.course_id,co.title AS course_title,e.status,e.progress,e.completed_at,
                c.id AS certificate_id,c.status AS certificate_status,
                CASE WHEN c.id IS NOT NULL THEN 'certified'
                     WHEN e.status='completed' THEN 'completed'
                     ELSE 'incomplete' END AS student_status
                FROM enrollments e JOIN learners l ON l.tenant_id=e.tenant_id AND l.id=e.learner_id
                JOIN courses co ON co.tenant_id=e.tenant_id AND co.id=e.course_id
                LEFT JOIN certificates c ON c.tenant_id=e.tenant_id AND c.enrollment_id=e.id """ + where + " ORDER BY co.title,l.name,e.id", args)]
        finally:
            db.close()

    @application.get("/api/certificates")
    def certificates(q: str = Query("", max_length=200), sort: SortField = "issued_date", direction: Direction = "desc",
                     page: int = Query(1, ge=1), page_size: int = Query(10, ge=1, le=100),
                     status: CertificateStatus = "", course_id: str = Query("", max_length=200), actor: dict = Depends(get_actor)):
        where, args = query_scope(actor["tenant_id"], q, status, course_id)
        db = connect(path)
        try:
            # Count and page share one snapshot, even while another request issues certificates.
            db.execute("BEGIN")
            total = db.execute("SELECT COUNT(*) FROM (" + CERT_SELECT + where + ")", args).fetchone()[0]
            rows = db.execute(CERT_SELECT + where + stable_order(sort, direction) + " LIMIT ? OFFSET ?", args + [page_size, (page - 1) * page_size]).fetchall()
            return {"items": [certificate_json(row, actor["timezone"]) for row in rows], "total": total, "page": page, "page_size": page_size}
        finally:
            db.close()

    @application.get("/api/certificates/export.csv")
    def export_csv(q: str = Query("", max_length=200), sort: SortField = "issued_date", direction: Direction = "desc",
                   status: CertificateStatus = "", course_id: str = Query("", max_length=200), actor: dict = Depends(get_actor)):
        where, args = query_scope(actor["tenant_id"], q, status, course_id)
        sql = CERT_SELECT + where + stable_order(sort, direction)

        def safe_cell(value: str) -> str:
            # Prevent spreadsheet execution without corrupting ordinary names or CSV quoting.
            return "'" + value if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else value

        def stream():
            db = connect(path)
            try:
                db.execute("BEGIN")
                cursor = db.execute(sql, args)
                buffer = io.StringIO(newline="")
                writer = csv.writer(buffer, lineterminator="\r\n")
                writer.writerow(["learner_name", "course_title", "serial_number", "issued_date"])
                yield ("\ufeff" + buffer.getvalue()).encode("utf-8")
                while rows := cursor.fetchmany(500):
                    buffer.seek(0)
                    buffer.truncate(0)
                    writer.writerows([safe_cell(row["learner_name"]), safe_cell(row["course_title"]), safe_cell(row["serial_number"]), row["issued_date"]] for row in rows)
                    yield buffer.getvalue().encode("utf-8")
            finally:
                db.close()

        return StreamingResponse(stream(), media_type="text/csv; charset=utf-8", headers={
            "Content-Disposition": f'attachment; filename="certificates-{actor["tenant_id"]}.csv"',
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
        })

    @application.get("/api/certificates/{certificate_id}")
    def certificate_detail(certificate_id: str, actor: dict = Depends(get_actor)):
        db = connect(path)
        try:
            db.execute("BEGIN")
            result = find_certificate(db, certificate_id, actor)
            rows = db.execute("""SELECT ae.id,ae.action,a.name AS actor_name,ae.created_at,ae.detail
                FROM audit_events ae JOIN admins a ON a.tenant_id=ae.tenant_id AND a.id=ae.actor_id
                WHERE ae.tenant_id=? AND ae.certificate_id=? ORDER BY ae.created_at,ae.id""", (actor["tenant_id"], certificate_id))
            result["audits"] = [audit_json(row, actor["timezone"]) for row in rows]
            return result
        finally:
            db.close()

    @application.post("/api/courses/{course_id}/issue")
    def issue(course_id: str, payload: dict = Body(default_factory=dict),
              idempotency_key: Annotated[str | None, Header()] = None, actor: dict = Depends(get_actor)):
        if not idempotency_key or not idempotency_key.strip() or len(idempotency_key) > 200:
            raise HTTPException(400, "需要 1–200 字符的 Idempotency-Key。")
        tenant = actor["tenant_id"]
        try:
            canonical_request = json.dumps({"course_id": course_id, "payload": payload}, sort_keys=True, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        except (ValueError, TypeError):
            raise HTTPException(422, "请求内容必须是有效 JSON，不能包含 NaN 或 Infinity。") from None
        request_hash = hashlib.sha256(canonical_request.encode()).hexdigest()
        db = connect(path)
        try:
            # Authenticate and authorize before creating even an operation/audit record.
            if db.execute("SELECT id FROM courses WHERE tenant_id=? AND id=?", (tenant, course_id)).fetchone() is None:
                raise HTTPException(404, "课程不存在。")
            db.execute("BEGIN IMMEDIATE")
            previous = db.execute("SELECT request_hash,result_json FROM operations WHERE tenant_id=? AND idempotency_key=?", (tenant, idempotency_key)).fetchone()
            if previous:
                if previous["request_hash"] != request_hash:
                    raise HTTPException(409, "此幂等键已用于其他请求，请为新操作使用新键。")
                if previous["result_json"] is None:
                    raise HTTPException(503, "操作尚未完成，请使用相同幂等键重试。")
                return json.loads(previous["result_json"])
            operation_id = uuid.uuid4().hex
            now = utc_now()
            db.execute("INSERT INTO operations VALUES (?,?,?,?,?,?,?,?,?)", (operation_id, tenant, actor["id"], course_id, idempotency_key, request_hash, "processing", None, now))
            enrollments_to_issue = db.execute("""SELECT e.id,e.learner_id,e.status,l.name AS learner_name,c.id AS certificate_id,c.status AS certificate_status
                FROM enrollments e JOIN learners l ON l.tenant_id=e.tenant_id AND l.id=e.learner_id
                LEFT JOIN certificates c ON c.tenant_id=e.tenant_id AND c.enrollment_id=e.id
                WHERE e.tenant_id=? AND e.course_id=? ORDER BY l.name,e.id""", (tenant, course_id)).fetchall()
            result = {"operation_id": operation_id, "course_id": course_id, "status": "completed", "issued": 0, "skipped": 0, "failed": 0, "outcomes": []}
            for enrollment in enrollments_to_issue:
                outcome = {"learner_id": enrollment["learner_id"], "learner_name": enrollment["learner_name"], "status": "skipped", "reason": "", "certificate_id": enrollment["certificate_id"]}
                if enrollment["status"] != "completed":
                    outcome["reason"] = "课程尚未完成。"
                elif enrollment["certificate_id"]:
                    outcome["reason"] = "已有证书且已撤销，本次不重新签发。" if enrollment["certificate_status"] == "revoked" else "已获证，无需重复签发。"
                else:
                    db.execute("SAVEPOINT issue_learner")
                    try:
                        certificate_id = uuid.uuid4().hex
                        serial = f"OCE-{tenant.upper()}-{now[:4]}-{uuid.uuid4().hex.upper()}"
                        db.execute("INSERT INTO certificates VALUES (?,?,?,?,?,?,?,?,?,?,?)", (certificate_id, tenant, enrollment["id"], enrollment["learner_id"], course_id, operation_id, serial, now, local_time(now, actor["timezone"])[:10], "active", None))
                        db.execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, tenant, actor["id"], certificate_id, operation_id, "issued", now, "课程已完成，批量签发证书。"))
                        db.execute("RELEASE SAVEPOINT issue_learner")
                        outcome.update(status="issued", reason="证书签发成功。", certificate_id=certificate_id)
                    except sqlite3.IntegrityError:
                        db.execute("ROLLBACK TO SAVEPOINT issue_learner")
                        db.execute("RELEASE SAVEPOINT issue_learner")
                        logger.exception("Issuance constraint failed for enrollment %s", enrollment["id"])
                        outcome.update(status="failed", reason="数据约束校验失败，未生成证书或审计记录。", certificate_id=None)
                result[outcome["status"]] += 1
                result["outcomes"].append(outcome)
            db.execute("UPDATE operations SET status='completed',result_json=? WHERE tenant_id=? AND id=?", (json.dumps(result, ensure_ascii=False), tenant, operation_id))
            db.commit()
            return result
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @application.post("/api/certificates/{certificate_id}/revoke")
    def revoke(certificate_id: str, actor: dict = Depends(get_actor)):
        db = connect(path)
        try:
            db.execute("BEGIN IMMEDIATE")
            certificate = find_certificate(db, certificate_id, actor)
            if certificate["status"] == "active":
                now = utc_now()
                changed = db.execute("UPDATE certificates SET status='revoked',revoked_at=? WHERE tenant_id=? AND id=? AND status='active'", (now, actor["tenant_id"], certificate_id)).rowcount
                if changed:
                    db.execute("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?)", (uuid.uuid4().hex, actor["tenant_id"], actor["id"], certificate_id, None, "revoked", now, "管理员确认撤销证书。"))
            result = find_certificate(db, certificate_id, actor)
            db.commit()
            return result
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @application.get("/api/audits")
    def audits(actor: dict = Depends(get_actor)):
        db = connect(path)
        try:
            rows = db.execute("""SELECT ae.id,ae.action,a.name AS actor_name,ae.created_at,ae.detail,ae.certificate_id,
                c.serial_number,l.name AS learner_name,co.title AS course_title
                FROM audit_events ae JOIN admins a ON a.tenant_id=ae.tenant_id AND a.id=ae.actor_id
                JOIN certificates c ON c.tenant_id=ae.tenant_id AND c.id=ae.certificate_id
                JOIN learners l ON l.tenant_id=c.tenant_id AND l.id=c.learner_id
                JOIN courses co ON co.tenant_id=c.tenant_id AND co.id=c.course_id
                WHERE ae.tenant_id=? ORDER BY ae.created_at DESC,ae.id ASC LIMIT 100""", (actor["tenant_id"],))
            return [audit_json(row, actor["timezone"]) for row in rows]
        finally:
            db.close()

    dist = ROOT / "frontend" / "dist"
    if dist.is_dir():
        if (dist / "assets").is_dir():
            application.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

        @application.get("/{frontend_path:path}", include_in_schema=False)
        def frontend(frontend_path: str):
            if frontend_path == "api" or frontend_path.startswith("api/"):
                raise HTTPException(404, "接口不存在。")
            requested = (dist / frontend_path).resolve()
            if requested.is_relative_to(dist.resolve()) and requested.is_file():
                return FileResponse(requested)
            return FileResponse(dist / "index.html")

    return application


app = create_app()
