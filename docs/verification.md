# Verification record

## Submitted build

On Windows, with Python 3.12 and Node.js 24, the final submitted build passed 41 tests in 24.49 seconds. The test runner reported one Starlette TestClient deprecation warning. The two browser scenarios used the built React application and a disposable SQLite database.

- With 100,006 East learners, the directory initially requested 20 rows. Searching for Alex Lee sent no enrollment request before expansion. Expanding the row sent one learner-scoped request and returned three enrollments. Switching to Bob exposed the West learner; requesting the East ID returned an empty array.
- The browser verified disabled issue controls during submission and a retry with the original key after a committed response was lost. Cancelling revocation sent zero mutation requests; confirmation sent one. A simulated 503 on the certificate list recovered after Reload.

## Export and recovery

On the same run the first two 100,000-row exports took 0.719 s and 0.438 s. A fresh download was interrupted after 50,000 rows. Following a process restart, a complete export took 0.968 s. All three complete files matched the independently queried rows and had SHA-256 f69de31f380dd8196b8c444d3653cfcae8eb20e50cfc8e790626d57116e08152. These are observations on the test machine.

An earlier clean checkout passed 39 tests in 3.66 s. Both demo actors initially had seven certificates. The two exports took 0.703 s and 0.453 s, the concurrent list returned 200 in 0.250 s, and the post-restart export took 0.469 s. The home page, static assets, tenant list totals, issuance, cross-tenant rejection and revocation were checked after restart. SQLite integrity and foreign-key checks passed. The first interruption test had accepted only connection refusal; Windows also reported a connection timeout after confirmed process exit. The corrected assertion accepted both connection failures.

## Earlier checks

The initial API suite passed 34 tests in 3.08 s after a sandbox socket restriction interrupted an earlier run. Initial browser checks exercised actor switching, the fixed West local date, individualized issuance outcomes, CSV contents, revocation history and empty search results. A 390 px viewport retained horizontal scrolling within wide tables. Review caught stale search parameters during export, late initial course selection and overflow from a visually hidden table heading. The fixes and their verification remain in the original commit history.

## Post-submission English build

The English build passed the complete verification command, including the two browser scenarios. With 100,000 East rows, the first two exports took 0.672 and 0.469 seconds; the concurrent list completed in 0.250 seconds. After interruption at row 50,000 and restart on the same database, the complete export took 0.453 seconds. All three SHA-256 digests matched the submitted build.
