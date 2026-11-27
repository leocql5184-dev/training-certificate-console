# Ocean Academy training certificate console

Tenant administrators can review course completions, issue certificates in bulk, inspect their audit history, revoke certificates, and export the filtered certificate register. The application uses React, TypeScript, FastAPI and SQLite.

## Start the application

From the repository root, with Python 3.12+, Node.js 22.12+ or 24 LTS, and npm installed, run:

```powershell
python run.py
```

Open http://127.0.0.1:8000. The first run needs internet access to install locked dependencies. The launcher builds the UI, seeds the database and starts the server. Use `--port 8010` to change ports. Ctrl+C stops the server. Restarts preserve changes in `data/certificates.db`. To reproduce first-issue scenarios without modifying existing records, start a separate instance:

```powershell
$env:CERT_DB_PATH = Join-Path $env:TEMP ("ocean-review-" + [guid]::NewGuid() + ".db")
python run.py --port 8010
```

## Demo actors and workflow

| Administrator | Tenant | Header | Time zone |
|---|---|---|---|
| alice@east.test | East | `X-Actor-Id: alice` | Australia/Sydney |
| bob@west.test | West | `X-Actor-Id: bob` | Australia/Perth |

Choose the actor in the header. Under **Courses and enrollments**, select **Safety 101** and issue certificates to eligible learners. Inspect each outcome. Under **Certificates**, search by learner or serial number, filter, sort and paginate. Open a certificate to see its local issue time and audit events. Revocation requires confirmation. CSV exports include all matching pages in the current order. The learner directory loads 20 people per page, then fetches enrollments when a learner is expanded. The audit log displays the latest 100 events. Interactive API documentation is at `/docs`.

Each tenant starts with six learners, three courses, 18 enrollments and seven certificates (five active and two revoked). Names match across tenants, including Alex Lee and Safety 101. IDs differ. Learner status is Incomplete, Completed or Certified. Certificate validity is recorded separately.

## Reproduce the acceptance scenarios

Run the full suite, including browser tests and the export benchmark:

```powershell
python run.py --verify --benchmark
```

For individual checks, run `python run.py --prepare` then set `$py = '.\.venv\Scripts\python.exe'` in PowerShell. Each API test initializes a fresh database. Each of A2 and A4 needs a fresh course to observe the initial issue count.

| Scenario | Command | What to check |
|---|---|---|
| A1 Tenant isolation | `& $py -m pytest -v -k test_a1 tests` | As Bob, request an East certificate detail, revoke it, and try to issue for an East course. Each returns 404. West list and export contain only West records. Certificate, operation and audit counts stay constant. |
| A2 Retry safety | `& $py -m pytest -v -k test_a2 tests` | As Alice, POST an empty JSON object to `/api/courses/east-course-safety/issue` with an Idempotency-Key. Sequential retries, replay after rebuilding the app and six concurrent submissions return the same operation and outcomes. Each new certificate has one issuance event. |
| A3 Key misuse | `& $py -m pytest -v -k test_a3 tests` | Reuse the key with a different course, then a different payload. Both return 409. Replaying the original payload, even with reordered JSON fields, returns the original result. |
| A4 Eligibility | `& $py -m pytest -v -k 'test_a4 or test_audit_failure' tests` | In a fresh East Safety 101 course, Jordan Chen and Riley Zhang receive certificates. Four other learners receive skip reasons. When one audit write is forced to fail, one succeeds, one fails and four skip. No certificate remains for the failed issuance. |
| A5 Tenant-local date | `& $py -m pytest -v -k test_a5 tests` | Open Alex Lee's Safety 101 certificate in each tenant. At 2026-01-10 13:30 UTC, Sydney shows Jan 11 00:30 and Perth shows Jan 10 21:30. Verify the CSV dates, ascending and descending date order, and ID tie-breaking. |
| A6 Export growth | `python run.py --benchmark` | Search for Load Learner and sort by learner name. Both complete exports must return exactly 100,000 matching East rows within 60 seconds. A list request succeeds during the first download. Each export matches an independent SQL query row for row. An additional download is interrupted at row 50,000. After restart on the same database and port, the complete download matches the first two. |
| A7 Revocation | `& $py -m pytest -v -k test_a7 tests` | Revoke an active certificate from its detail panel. The test sends four concurrent requests and a retry. All return revoked with the same timestamp. The database gains one revocation audit event. |

For manual large-data checks, generate a separate database:

```powershell
& $py -m backend.seed_large --count 100000 --tenant east --db data/large-demo.db
$env:CERT_DB_PATH = 'data/large-demo.db'
python run.py --port 8010
```

Close this shell after testing or run `Remove-Item Env:CERT_DB_PATH` to restore the default. Browser tests use Playwright Chromium if installed, otherwise Edge on Windows or Chrome elsewhere. Set `BROWSER_EXECUTABLE` to select a compatible browser, or run `npx playwright-core install chromium` in `frontend` after preparation. Run just the two browser scenarios with `& $py -m pytest -v tests/test_browser.py`.

## Design and limitations

- Tenant-scoped composite foreign keys and uniqueness constraints protect relationships. The actor header provides demo identity. Certificate issuance, audit events and the persisted operation result commit together. Revocation retains the certificate and prevents reissue.
- SQLite serializes writes. Directory search matches names and email addresses within a tenant. For compatibility, an API caller omitting the directory page parameter receives the full array.
- Removing only the virtual environment can leave a stale dependency stamp. To recover, reinstall with `.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt`.
- Historical seed descriptions and audit text in previously created databases retain the language used when written. Use a fresh demo database for an English walkthrough.
- See the [data model](docs/data-model.md), [API contract](docs/architecture.md) and [verification record](docs/verification.md).

## Assessment evidence

The [session index](ai/session-index.csv), [decision log](ai/decision-log.md) and [completeness declaration](ai/completeness.md) identify the evidence and its limits, including the time overrun. Original interactions retain their recorded language. [Written answers](written-answers.md) contains the candidate's independently supplied original. This English companion was prepared after submission; the originally emailed commit remains available at `d2887ae79f8d9bb74d578398a8ec714e27d1bc57`.
