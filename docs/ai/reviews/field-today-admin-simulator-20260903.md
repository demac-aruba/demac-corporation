# Review: Field today-only route and temporary admin simulator

## Review mode

- [x] Independent Review
- [ ] Solo Maintainer Adversarial Review

Reviewer / agent: Field simulator reviewer (`/root/field_simulator_review`), with independent data-parity review by `/root/field_data_analysis` and mutation-boundary analysis by `/root/field_backend_analysis`
Implementation author / agent: primary integration agent (`/root`)

## Scope reviewed

- Request/acceptance criteria: show technicians only the current Aruba day and give Super Admin a temporary preview selector for real Agenda work by Van or technician, with a safe workflow simulation.
- Diff/commit: complete uncommitted feature-branch diff before preview publication.
- Affected callers/integrations: ERP Next `/field`, canonical Scheduling `workOrders`, Van/daily crew resolution, Firebase users/staff profiles, Field read API and every Field mutation using the shared assignment resolver.
- Authorities and rule IDs: Scheduling owns plan/date/Van; Field Operations owns execution; Firebase `users/{uid}` owns portal identity; `FIELD-DAY-001` and `FIELD-PREVIEW-001`.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Low | `apps/erp-next/components/field/field-admin-simulator.tsx` | Branch buttons intentionally demonstrate the allowed state without collecting the reason required by canonical writes. The mode is local-only and cannot call a mutation, so it cannot create invalid truth. | Add reason-entry UX only if this temporary simulator is promoted beyond fast concept validation. |
| Low | `apps/erp-next/components/field/field-admin-simulator.tsx` | Reset clears React's displayed filename state but does not clear the browser-native file input value. No upload or persistence occurs. | Clear the native input if repeated same-file selection becomes relevant to UAT. |

Corrected during review: future-range access, mutation known-ID bypass, stale async results, inactive/legacy Van aliases, partial dated crew overrides, UID/staff/profile fallback mapping, user activation/role filtering, Van-without-driver execution, helper capabilities, canonical transition branches, Office Review boundary, completed-job reopening and stale detail state.

## Verification

- Required checks run: simulator/domain/security/offline client suites, TypeScript, Next production build, full Field Functions suite and diff hygiene.
- Results: all pass; Function suite reports 352/352 passing tests. Independent reviewer decision is PASS with no Critical/High/Medium findings.
- Security and permission cases: selector requires both preview/development build gate and `super_admin`; production/non-admin paths fail closed; simulation imports no write/upload/outbox API; technician read and mutation date guards are server-owned.
- Business-invariant cases: exact Aruba day; canonical active Van catalog, aliases and record preference; daily override blank/inherited semantics; direct UID/staff assignment; raw profile-Van compatibility fallback; lead/technician/helper/office capabilities.
- Retry/concurrency/idempotency cases: request generation guards stale schedule results; selected identity is part of the ownership key; canonical mutations retain existing server idempotency and transaction tests.
- Failure/recovery cases: read failure is explicit/retryable and does not fabricate data; removing the preview prop/component rolls back without data migration.
- Unverified areas: real technician mutation UAT and production Function/Rules rollout remain outside this preview-only release boundary.

## Decision

- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block / changes required

Residual risk, owner, and due date: DEMAC Engineering owns the two low simulator-polish items if the temporary prototype is retained. Production activation remains governed by the pre-existing Function-first deployment and authenticated-UAT blockers; this change does not waive them.

Human approval still required before any action covered by the repository Human Approval Boundary: the owner requested merge/preview publication for this concept. No production Function, Firestore Rules, migration, destructive action or technician impersonation is authorized by this change.
