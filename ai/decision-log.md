# Decision log

Times are UTC and refer to the archived interactions.

| Decision | Evidence and verification |
|---|---|
| Adopt the local stack | At 13:09:18 the assistant proposed React, FastAPI and SQLite. At 13:13:21 the candidate chose this stack and specified eight entities. The model and startup contract are in 711d537, the API in 3b2ffbf and the UI in 2436845. The clean-checkout test verified both tenants. [Main session](sessions/session-359a48ae97b3.jsonl) |
| Correct the learner states | At 13:33:24 the candidate requested exactly three visible states. Commit 526f81e derives the learning state separately from certificate validity. The acceptance test verifies that revocation preserves the learner's issuance history. [Main session](sessions/session-359a48ae97b3.jsonl) |
| Retain revoked certificates and their unique relationship | A revoked certificate continues to occupy the tenant, learner and course combination. This preserves audit continuity and precludes issuance of a replacement serial number. See the constraints and A4/A7 in 3b2ffbf and the history test in 526f81e. [Backend session](sessions/session-d7f79a7b0329.jsonl) |
| Paginate the directory and test the browser | The 13:58:33 review found a tenant-wide enrollment download and a UI regression gap. At the candidate's request, 1a221f4 added pagination, learner-scoped expansion and browser tests for retries and revocation. [Main session](sessions/session-359a48ae97b3.jsonl) |
