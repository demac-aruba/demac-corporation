# Careers: persistent administration and rollout

## Task / authority / approval
The owner approved implementation and merging on 2026-09-08, conditioned on preserving the existing DEMAC design and operational modules. After the readiness block, the owner requested fixing it. This change is Deep Review because candidate PII, server persistence and private documents are new behavior. Production activation is separate from code compilation and remains gated.

## Canonical source of truth (ADR)
`functions/careers` owns the recruitment domain in the existing Firebase project. `careersVacancies`, `careersApplications`, `careersSessions`, `careersSettings`, `careersOperations`, `careersAudit`, `careersEmailJobs`, `careersRateLimits` and `careersFileDeletions` are the sole domain collections. They are not duplicates of employee, customer, appointment, payroll or conversation data. The browser is not the source of truth. New collections and `careers-private/` objects remain denied by existing client rules; all access goes through the two new server authorities. No Firestore/Storage rule change is required or included.

Admin requests reuse the existing Firebase session, token-revocation check and the authoritative `users` profile (`active:true`, `role:admin`). No role is granted automatically. The menu is restricted to the current super-admin presentation role. Submitted profile/job/question snapshots are immutable. Stage and notes require current version and recheck authorization inside the transaction. Publishing does not create appointments or employees.

## Release configuration — no invented values
Do not enable live intake until DEMAC supplies/approves its Careers sender, actual SMTP service, privacy notice and retention periods, and a private antivirus service is configured. No real email was sent in tests. Use the existing secret-management procedure for `CAREERS_SMTP_PASSWORD` and `CAREERS_RATE_SALT`; do not commit their values.

Server variables: `DEMAC_CAREERS_BACKEND_ENABLED`, `CAREERS_ALLOWED_ORIGINS` (exact approved web/ERP origins), `CAREERS_SMTP_HOST`, `CAREERS_SMTP_PORT` (465/587 TLS), `CAREERS_SMTP_USER`, `CAREERS_VERIFIED_FROM`, `CAREERS_CLAMD_HOST` (private IP, port3310) or `CAREERS_CLAMD_SOCKET`, `CAREERS_VPC_CONNECTOR` when needed, `CAREERS_RELEASE_APPROVED`, `CAREERS_RETENTION_APPROVED`. Missing configuration fails closed. A private VPC/ClamAV service and fresh signature database require operational configuration; their existence is not implied by this code.

Frontend flags: `NEXT_PUBLIC_CAREERS_ADMIN_ENABLED=true` exposes the authorized administrative menu; `NEXT_PUBLIC_CAREERS_LIVE_ENABLED=true` switches `/careers` from gated design preview to the server-backed public experience. `NEXT_PUBLIC_CAREERS_FUNCTIONS_BASE_URL` is an optional controlled staging override. `/careers-preview` remains isolated and unavailable in production.

Save Careers settings with intake OFF; verify the saved scanner connection and SMTP TLS/authentication (no message sent); enable intake only after release approval and run a separately authorized end-to-end live receipt check. Verification of SMTP login is not proof of sender deliverability or delivered mail. No SPF/DKIM/DMARC state is fabricated.

## Files, mail and retention
Uploads are bounded per file/session and reserve capacity transactionally. The scanner receives actual bytes. Files that cannot be scanned are not accepted as clean. Images are re-encoded; CV types are checked against their contents. Each upload attempt has a unique lease-bound object path and a pinned generation/digest. Downloads authenticate every request and use attachment/no-store/nosniff/sandbox headers, never permanent public URLs. Object removals have durable cleanup jobs.

Submission atomically creates one application, an event and one confirmation-email job. Idempotent retries do not duplicate a record or message job. SMTP acceptance is not delivery. Timeout/ambiguous send or an expired send lease becomes `delivery_unknown`, with no automatic resend. Clear pre-connection failures retry a bounded number of times. Review uncertain delivery manually; no resend control is exposed without a safe operational reconciliation policy.

The gated maintenance function processes only Careers records. Expired draft uploads are removed; expiry of a submitted session does not remove the application's documents. Expired application records and nested notes/events are deleted only with the explicit retention deployment approval. In-flight candidate drafts remain in memory, with refresh warnings; submitted records are persistent. No demo candidates or vacancies are seeded by application code.

## Verification and remaining risks
Tests must pass at the exact proposed head. Existing visual/navigation suites remain mandatory, including native Back/Forward. Dedicated backend CI uses only demo Firestore/Storage emulators, checks cross-instance persistence, concurrency/version conflicts, idempotency, private document access, rule-denied anonymous reads, failed scanner/mail behavior and retention separation. Scanner and SMTP integration tests use controlled doubles/protocol fixtures; they do not certify a deployed service. Actual Mac/iPhone/Galaxy and live SMTP receipt tests remain separate explicit checks.

Before merge: fresh Solo Maintainer Adversarial Review of the complete diff; existing CI/build gates; verify that operational paths/styles/rules are unchanged except the new scoped export/menu. Do not label this review independent. Deployment plan: enable the new backend only, save and verify configuration, enable frontend flags last. Rollback: pause Careers intake/disable Careers flags; preserve all candidate records; do not roll back or delete other modules.
