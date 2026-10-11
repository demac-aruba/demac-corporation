# Task: Restore appointment backend availability

## Context

- Owner reports `Failed to fetch` in Scheduling → Appointment detail → Charges and payments.
- Delivery mode: Deep Review (production incident affecting financial reads and shared booking infrastructure).
- Main at investigation start: `ffdc1bc19219f343836b087be2ab20320171db5b` (frontend PR #567; no backend deployment).
- Incident remains **unresolved**. Draft PR #568 contains diagnostics, not a production fix.

## Scope

- In scope: read-only function/service metadata, bounded sanitized technical signals, aggregate monitoring metrics, public preflight and unauthenticated denial probes.
- No production writes, authenticated customer reads, IAM changes, deployment, capacity changes, migrations or payment retries performed.
- Files: diagnostic workflow, script and output-sanitization tests. Product code is unchanged.

## Governance

- Booking Authority remains scheduling/appointment authority; `OPS-SCHED-CHARGES-001` and the existing payments authority are unchanged.
- Security: existing configured CI identity; credentials stay inside the authenticated runner; no environment values, raw logs or customer data emitted. Logging permission denial is respected, not bypassed.
- No Legacy parity, schema or architecture decision changes.

## Acceptance criteria

- [x] Reproduce backend failure independently of the screen.
- [x] Record deployed revision and configuration without production mutation.
- [x] Validate diagnostic output does not expose raw private text on success/failure.
- [ ] Establish a justified, bounded restoration action and independently review it.
- [ ] Recover repeated OPTIONS 204 with CORS and unauthenticated POST 401 on both canonical endpoints.
- [ ] Verify the authorized appointment finance read and recovery workflow after restoration.

## Evidence (UTC)

- 2026-10-11 00:28–00:29: Cloud Functions endpoint returned Google Frontend 503 without CORS.
- 00:35–00:45: Cloud Functions and direct Cloud Run endpoints returned 429 without CORS, including preflight requests from the real production origins. A separate booking reference endpoint returned 204 during the initial control probe.
- Service revision is `officebookingauthority-00082-dov`, ACTIVE/Ready, traffic 100%, 256 MiB, CPU 0.1666, concurrency 1, max 100. Configuration readiness does not establish runtime availability.
- Revision 82 matches the backend release already verified by workflow run `38092156996` at 2026-10-10 22:44. Function metadata update time 2026-10-11 00:28:31 does **not** prove a new code revision.
- Final complete four-hour metrics query (run `38099459640`, job `114352187180`, diagnostic head `667c573437543c288563fd353ef140720bbe34cd`) filters revision 82 and reports no truncation for all seven metrics.
- Coverage refers to the API page, not printed history: output retains only the latest 15 nonzero samples per series; it does not report historical peaks or every zero sample.
- Latest observed successful 200/204 samples: 2026-10-10 23:17. Last nonzero idle sample: 23:32. Earlier one-hour samples showed zero active/idle instances throughout 00:31–00:38. Successful startup probes at 22:45, 23:05 and 23:06; no failing startup probe series returned. HTTP 500 samples at 00:25/00:27, then 429 from 00:33 onward.
- Last memory utilization sample: mean 0.691 at 23:32, one observation. This does not establish an OOM or exclude an unsampled failure.
- Request-count metrics do not account for every gateway rejection; they cannot prove low total traffic or exclude a quota problem.
- Cloud Logging read returns `PERMISSION_DENIED`. Root cause remains unconfirmed without runtime/platform error evidence.
- An earlier four-hour query was truncated by its 100-point page size and showed only revision 80. It is superseded by the revision-filtered query above and must not be used as evidence about revision 82.

## Plan and risk

- Next required evidence: sanitized runtime/system error records for service `officebookingauthority`, revision 82, approximately 2026-10-11 00:20–00:50 UTC, supplied by an authorized logs reader or made available through existing approved read access.
- Do not infer OOM from 429 or increase memory based on this diagnosis. Do not roll back to an arbitrary revision; the current revision previously served successfully.
- A future restoration must preserve canonical data and credentials, identify exact artifact/configuration and rollback, then verify runtime and authenticated read behavior. Successful diagnostics are not evidence of recovery.
- Diagnostic rollback: close draft/remove this branch; nothing has been applied to production.

## Verification

- Output-sanitization tests: 3/3 PASS, including synthetic private text and command failure containment.
- Node syntax and diff checks: PASS at diagnostic head.
- Read-only diagnostic workflow: completed; Cloud Logging unavailable, runtime probes still fail.
- No payment transaction or customer-data mutation used for verification. Product regression/deployment gates are pending an actual correction.

References: [authority matrix](../AUTHORITY_MATRIX.md), [security rules](../SECURITY_RULES.md), [review](../reviews/booking-runtime-incident-20261011.md).
