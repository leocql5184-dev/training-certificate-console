# Certificate administration design and API contract

The user selected FastAPI + React + SQLite and authorized the full local workflow. Alternatives considered: all-TypeScript backend reduces languages; PostgreSQL adds infrastructure. SQLite fits the local assessment and persists all business state.

## Relations
- tenants 1:N admins, learners, courses, enrollments, certificates, operations, audit_events.
- learners N:M courses through enrollments, unique (tenant_id, learner_id, course_id).
- enrollments 1:0..1 certificates. Revocation does not free the unique slot.
- operations 1:N issued certificates and audit events; holds idempotency key, canonical request hash and replayable result.
- admins 1:N operations/audit_events. All business FK relations enforce tenant consistency using composite foreign keys where applicable.
- certificates 1:N audit_events; issuance once, revocation at most once. Store UTC timestamp plus tenant-local calendar date used for indexed date sorting and CSV.

## API contract (root owns this file; coordinate changes)
All protected endpoints use `X-Actor-Id` header (`alice`, `bob` demo IDs). Actor list is public and lists only demo identity and tenant metadata. Responses use snake_case. All errors use {detail: string}. All query values are validated. Search is parameterized. IDs are strings.

- GET /api/health -> {status:"ok"}
- GET /api/actors -> [{id,name,email,tenant_id,tenant_name,timezone}]
- GET /api/overview -> {learners:int,courses:int,enrollments:int,completed:int,eligible:int,active_certificates:int,revoked_certificates:int}
- GET /api/courses -> [{id,title,description,enrolled_count,completed_count,eligible_count,certificate_count}]
- GET /api/learners?q= -> [{id,name,email,enrolled_count,completed_count,certificate_count}]
- GET /api/learners?page=1&page_size=20&q= -> {items,total,page,page_size}. Page size 1–100. Select learners by name and ID before aggregating enrollment counts for the page.
- GET /api/enrollments?learner_id=... returns only that learner's records within the actor's tenant. The directory requests this on expansion. Course and search filters can be combined.
- GET /api/enrollments?course_id=&q= -> [{id,learner_id,learner_name,learner_email,course_id,course_title,status:"completed"|"in_progress"|"not_started",student_status:"incomplete"|"completed"|"certified",progress:int,completed_at:string|null,certificate_id:string|null,certificate_status:string|null}]
- GET /api/certificates?q=&sort=issued_date&direction=desc&page=1&page_size=10&status=&course_id= -> {items:[Certificate],total,page,page_size}. sort enum: learner_name, course_title, serial_number, issued_date; status active/revoked. Append ID tie-breaker consistently to list/export.
- Certificate: {id,serial_number,learner_id,learner_name,course_id,course_title,issued_at,issued_local,issued_date,status:"active"|"revoked",revoked_at:string|null}. issued_local is YYYY-MM-DD HH:mm. issued_date is YYYY-MM-DD.
- GET /api/certificates/{id} -> Certificate plus {audits:[{id,action,actor_name,created_at,created_local,detail}]}
- POST /api/courses/{id}/issue, header Idempotency-Key, JSON {} -> {operation_id,course_id,status:"completed",issued:int,skipped:int,failed:int,outcomes:[{learner_id,learner_name,status:"issued"|"skipped"|"failed",reason,certificate_id:string|null}]}. Validate course within tenant before any writes. Same key/request returns same operation; changed course/payload 409. Include incomplete and already-certified enrollments as skipped. Allow arbitrary JSON object payload fingerprinting; no payload fields alter eligibility.
- POST /api/certificates/{id}/revoke JSON {} -> Certificate; idempotent state transition with exactly one revocation audit.
- GET /api/certificates/export.csv?q=&sort=&direction=&status=&course_id= -> streaming UTF-8 BOM CSV with learner_name,course_title,serial_number,issued_date. Export ALL matching rows, stable order, preserve CSV quoting and guard formula injection. Route registered BEFORE /{id}.
- GET /api/audits -> [{id,action,actor_name,created_at,created_local,detail,certificate_id,serial_number,learner_name,course_title}]; latest 100 scoped records.

## Persistence and demo cases
SQLite foreign_keys ON, WAL, connection per request, busy timeout, write transactions BEGIN IMMEDIATE. Bulk operation, actual issuances, audit events and saved result commit together. Unique certificate per tenant/enrollment. Same request concurrent callers serialize then replay persisted response. Use per-learner savepoint for a failed outcome; unexpected whole-operation failure rolls back. Do not turn unexpected database errors into skipped successes.

Seed idempotently: East Australia/Sydney, West Australia/Perth; alice@east.test, bob@west.test. Six learners per tenant with mirrored names Alex Lee, Jordan Chen, Morgan Wang, Taylor Lin, Casey Wu, Riley Zhang. Three mirrored courses Safety 101, Data Privacy, Workplace Essentials. Both tenants cover completed eligible, incomplete, not_started, active certificate, revoked certificate, and fixed UTC 2026-01-10T13:30:00Z DST/date example. Add a course with zero enrollments for an empty state if useful. Deterministic IDs prefixed east-/west-. Large dataset generation must be opt-in and separate from default seeding.

## Interface direction
Operate mode. Chinese interface named Ocean Academy / 学习与认证工作台. Light cool-gray workspace, white readable data tables, dark navy sidebar, restrained teal primary action. Four main views: 证书管理, 课程与选课, 学员目录, 审计日志. Header actor selector displays tenant and timezone. Certificate table central; count strip is compact text, no oversized dashboard hero. Course view shows real progress and eligible counts, bulk results panel, certificates open in accessible detail drawer with audit history and revoke confirmation. Responsive navigation and horizontally scrollable tables on small screens. Keyboard focus, feedback, cancellation and stale-request protection on actor switch.

## Verification
Automate A1-A7 using an isolated temporary SQLite file. Verify list/export search, stable duplicate-key ordering, local date, sequential and concurrent idempotency, key misuse, no cross-tenant side effects, repeated revoke. Run a real 100k-row HTTP streaming benchmark with a concurrent list request. Verify browser workflow and error/empty states. One documented startup command prepares declared dependencies, seeds data, builds React and serves the complete app on loopback; verification is separate.

## Student status (user update)
The UI and learning-status filter expose exactly 未完成 / 已完成 / 已获得证书, from the server-derived student_status field. Existing raw learning progress is preserved: not_started and in_progress map to incomplete; completed with no certificate maps to completed; any issued certificate maps to certified. Revoked certificates remain historical issuance and expose revoked separately in the certificate column.
