# Review: Advanced canonical Vans profile

## Review mode

- [ ] Independent Review
- [x] Solo Maintainer Adversarial Review

Reviewer / agent: ChatGPT
Implementation author / agent: ChatGPT

This is a separate adversarial pass under the repository's Solo Maintainer Review Mode. It is not an independent review.

## Scope reviewed

- Request/acceptance criteria: owner-approved advanced Vans workspace with canonical crew assignment, optional third helper, Van-owned partial day, daily overrides, WhatsApp group configuration, derived capacity, maintenance/repair history, and Add Van.
- Diff/commit: PR #454; code-reviewed through `ac937a0bc18cd7212f41c96518808e8575fa29d8` before this review-document commit.
- Affected callers/integrations: `/vans`, `/technicians`, Employee technical schedule resolution, canonical operations loaders/mutations, Firestore REST writes, Booking Authority Van-capacity boundary, Van WhatsApp schedule settings, `vanMaintenanceLogs`, `dailyVanAssignments`, `vanHalfDaySchedules`.
- Authorities and rule IDs: `vans` owns regular crew/profile; `dailyVanAssignments` owns dated overrides; `vanHalfDaySchedules` owns technician partial-day rules; `vanMaintenanceLogs` owns vehicle service/repair history; existing Van WhatsApp fields own group mapping; Booking Authority remains the scheduling-capacity authority for VAN-1..VAN-4.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Medium | PR review gate | Initial PR text incorrectly required an independent reviewer even though repository governance permits Solo Maintainer Review Mode when no external engineer is reasonably available. This would create an artificial permanent blocker. | Corrected PR #454 to explicitly use Solo Maintainer Adversarial Review and not describe it as independent. |
| Medium | `van-profile-acceptance.ts` / future-Van protection | First PR CI build failed because a test expected VAN-5 to fail for missing crew, while the intended protected Booking Authority boundary correctly blocks live VAN-5 capacity before that condition. Production rule was correct; fixture expectation was wrong. | Split the assertions: protected VAN-1 tests missing-driver behavior; fully crewed VAN-5 tests the explicit VAN-1..VAN-4 Booking Authority boundary. |
| Medium | Daily override removal | Initial implementation used a Firestore hard delete for `dailyVanAssignments`, erasing actor/date evidence and weakening recovery/auditability. | Replaced removal with audit-preserving cancellation: keep the record, preserve original date, clear active date, set `Cancelled`, and record cancellation actor/time. Resolution and conflict checks ignore cancelled overrides. Removed the no-longer-needed generic Firestore delete primitive from the PR. |
| Medium | Maintenance retry behavior | A new random log ID on each submit could duplicate maintenance/cost history when the first write succeeded but the client received an ambiguous timeout and retried. | Added retry deduplication for exact same-user/same-Van/same-service payloads so an ambiguous retry reuses the existing service row rather than appending a duplicate. |
| Low | Cross-document crew concurrency | Regular-crew and dated-override exclusivity are validated by reading current Firestore state before a client write; two truly simultaneous operations users could theoretically pass the check before either write becomes visible. | Recorded residual risk. Current UI and Firestore role enforcement remain authoritative for normal use; a future server-side transactional authority would be the stronger concurrency boundary if concurrent fleet editing becomes common. |
| Low | Multi-document save recovery | Van profile + half-day save and maintenance-log + Van-summary update are multi-step, not one atomic transaction. A network failure between steps can leave one successful and one pending. | Retry is safe/idempotent enough to recover: deterministic Van/schedule IDs and maintenance retry deduplication allow the operator to retry. Record as residual recovery behavior rather than hiding partial success. |
| Low | Visual authenticated smoke | CI validates compilation, domain rules and integration regressions, but this review session does not have an authenticated interactive ERP browser to click through every final control. | Owner should perform the production smoke checklist after merge; no automated correctness/security gate is waived. |

## Verification

- Required checks run on code head `ac937a0bc18cd7212f41c96518808e8575fa29d8`:
  - ERP Next CI run `33176029355` — PASS.
  - TypeScript and web build validation run `33176029333` — PASS.
  - Van Schedule Architecture run `33176029341` — PASS.
- Results:
  - ERP Next typecheck — PASS.
  - Dispatch acceptance — PASS.
  - Appointment lifecycle acceptance — PASS.
  - Booking intelligence acceptance — PASS.
  - Booking Copilot acceptance — PASS.
  - Live scheduling acceptance — PASS.
  - Employee schedule architecture acceptance — PASS.
  - Van schedule ownership/capacity architecture — PASS.
  - Production Next.js build — PASS.
  - Vans domain acceptance includes regular crew, optional third helper, duplicate-slot prevention, cross-Van exclusivity, safe clearing, date overrides, cancelled-override recovery, protected future-Van activation, and exact partial-day hours.
- Security and permission cases:
  - `firestore.rules` reviewed. `vans`, `dailyVanAssignments`, `vanMaintenanceLogs`, and `vanHalfDaySchedules` remain protected by existing active-staff read and operations/admin write rules; this PR makes no security-rule change.
  - UI mutation capability remains `scheduling.manage`; Firestore rules remain server-side enforcement.
  - No secrets, credentials, or access-rule changes in scope.
- Business-invariant cases:
  - Van remains the single regular-crew authority; Employee/Technician pages derive assignment from Van fields.
  - `primaryVanId` is not restored as a writer/source of truth.
  - Third helper is optional and included in crew/schedule/readiness resolution.
  - Sunday remains outside recurring Van partial-day selection.
  - Future Vans may be created/configured but cannot become live Booking Authority capacity beyond VAN-1..VAN-4 without a separate explicit expansion.
- Retry/concurrency/idempotency cases:
  - Van and half-day writes use deterministic document identities and can be retried.
  - Daily override uses deterministic Van/date identity; cancellation keeps audit evidence and releases active assignment.
  - Maintenance exact retry is deduplicated.
  - Cross-document simultaneous-editor race remains recorded residual risk.
- Failure/recovery cases:
  - New Vans default out of service, preventing silent capacity creation.
  - Partial multi-document failure can be recovered by retry; no destructive rollback/migration is required.
  - WhatsApp schedule delivery for future Vans is blocked until Booking Authority fleet expansion.
- Unverified areas:
  - Authenticated visual/interaction smoke in the deployed ERP remains owner validation after merge.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Residual risk, owner, and due date:
- Cross-document simultaneous-editor race: Engineering follow-up only if fleet editing becomes concurrent/multi-operator enough to justify a server-side transactional fleet authority. No current merge blocker.
- Authenticated production UI smoke: DEMAC owner immediately after approved merge/deployment.

Human approval still required before merge/deployment to `main`, which may activate production deployment paths. No production data mutation, destructive migration, security-rule change, secret change, or new source of truth is authorized by this review.
