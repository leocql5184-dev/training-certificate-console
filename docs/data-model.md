# Data model

| Entity | Purpose and relationships |
|---|---|
| tenants | Own the time zone and all tenant-scoped business records. |
| admins | Each administrator belongs to one tenant. The actor header identifies the administrator. |
| learners | Belong to one tenant. Display names can match across tenants. |
| courses | Belong to one tenant. A title can appear in both tenants. |
| enrollments | Join a learner to a course in the same tenant. Store progress, completion status and completion time. |
| certificates | At most one per tenant, learner and course. Store serial number, UTC issue time, local issue date, status and optional revocation time. |
| operations | Bind a tenant-scoped idempotency key to a course, request digest and complete outcome. A single operation can issue multiple certificates. |
| audit_events | Connect the tenant, actor and certificate to an issuance or revocation, and to the operation when applicable. |

Both tenants contain Alex Lee, Jordan Chen, Morgan Wang, Taylor Lin, Casey Wu and Riley Zhang. Both offer Safety 101, Data Privacy and Workplace Essentials. The seed covers eligible, incomplete, previously certified and revoked cases as well as an instant that falls on different local dates.

Composite foreign keys enforce tenant ownership. A retried issue replays the stored result; changing the course or payload returns 409. Certificate and audit writes are transactional. Revocation retains the unique certificate relationship and its history. Repeated revocations add no audit events.

The UI derives three learning states. Not-started and in-progress enrollments display as Incomplete. A completed enrollment without a certificate displays as Completed. A learner who has received a certificate displays as Certified, including after revocation. The certificate itself separately shows Active or Revoked.
