# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User-selected FastAPI + React + SQLite. TypeScript and Vite for the frontend.

## Users
Tenant administrators reviewing their learners, enrollments, courses and certificates.

## Product Purpose
A working local training administration console with bulk issuance, certificate revocation, tenant-scoped search and CSV export.

## Capabilities and Constraints
Follow the supplied assessment's A1-A7. Actor selection replaces login. Persistent relational data, retry-safe writes, exact audit events, IANA time zones, stable streaming export of 100,000 rows. East and West have matching learner/course names but separate records. No cloud deployment, notifications or production authentication.

## Operating Context
Chinese-language desktop admin workflow, responsive for narrow screens. Seed data is explicitly synthetic. Current task authorizes implementation and local preview of the approved stack and entities.

## Product Principles
Correct tenant scope; visible outcomes for every learner; reversible navigation; readable dense tables; explicit confirmation for revocation.

## Open Decisions
Implementation choice: revoked certificates remain unique and are not reissued. Default visual design is delegated to the builder by this implementation request.
