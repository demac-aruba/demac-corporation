# Task: restore authenticated split-attendance saves

## Context and scope

Owner reports PERMISSION_DENIED when saving 08:00–17:00 (60m break),
19:30–05:00 next day, 570 overtime minutes at 200%. Owner explicitly requested
in-depth investigation and repair; the existing merge/deploy authorization for this
feature continues. Real employee records must remain untouched during diagnosis/release.

Deep Review applies: payroll write path, authentication compatibility and concurrency.
Repair only the browser transport; retain the split model, calculations, UI, canonical
identities, before/after history and permission boundaries. No backend/rules/IAM/data migration.

## Evidence and authority

- PR625 introduced readWrite `beginTransaction` using a Firebase web ID token.
- Firebase's documented web protocol uses optimistic version checks, not the built-in
  server transaction API. SDK `core/transaction.ts` uses BatchGet + Commit, with Verify
  for all read-only documents, including missing documents.
- Initial browser/transport tests mocked that boundary, so they did not validate the
  actual Auth/Firestore Rules protocol. This incident closes that coverage gap.
- Read-only audit 40257815218 confirms active production Rules equal repository Rules
  (SHA256 8dbcaecf7d6faee427cc3600680f542c0be495c0e43f8366c39e3ed1418c5624).
  Its first log projection request returned HTTP400; this is a diagnostic request error,
  not evidence about the user's transaction. No employee documents were read/written.
- Authority: existing employeeTimesheets with payrollRole (active admin/accounting).
- Rules: OPS-STAFF-ATTENDANCE-SPLIT and OPS-STAFF-ATTENDANCE-OT-RATE.

## Acceptance and implementation

- One masked Commit protected by the target's exact updateTime or exists:false.
- Verify every adjacent record's exact version or absence in that same atomic Commit.
- No BeginTransaction/Rollback, placeholders, role expansion, or silent conflict retry.
- Preserve unknown fields/history and exact lost-response retry behavior.
- Reject malformed/incomplete/versionless reads before any write.
- Identify read-vs-save failure without reflecting request data or server bodies.
- Real emulator HTTP: admin/accounting allow; office/technician/inactive/unprovisioned/
  anonymous deny; role revocation before commit denies; target and neighbor creation,
  update and deletion races abort; full split lost-response retry creates one history entry.
- Browser desktop/mobile: real Firebase Auth login/session, real REST save to emulator,
  unchanged repository Rules, persisted rates and intervals survive reload; no cloud requests.

## Verification and recovery

Local typecheck, attendance/domain/transport tests and real Auth+Firestore emulator
cases PASS. Release build and independent review are required before merge. Browser CI
is required because the local Chromium download was unavailable. No gate is waived.

Recovery is frontend-only forward repair. Do not revert the split feature/data model or
change backend writers. No rollback should discard the existing split-aware checks.
Final CI, review and release evidence is recorded in the PR.

Sources:
- https://firebase.google.com/docs/firestore/transaction-data-contention
- https://github.com/firebase/firebase-js-sdk/blob/main/packages/firestore/src/core/transaction.ts
- https://cloud.google.com/firestore/native/docs/security/iam

## Completed verification checkpoint

- Source under review: 4d419099e974ff0aaeb59febacd93aefb2592a36.
- Typecheck, complete production build/prebuild gates: PASS locally.
- Authenticated transport, domain and emulator regression: PASS locally and repeated
  independently by /root/attendance_review.
- Real desktop/mobile login, REST save and reload: PASS in workflow 40258094150,
  artifact 12623715085. Zero production requests; synthetic data only.
- Corrected read-only audit 40258090824: active Rules still identical, log query returned
  no entries. There is no captured trace of the user's specific failed request.
- Emulator probe accepts BeginTransaction (HTTP200), so it does not reproduce the
  production IAM limitation. Diagnosis remains a protocol incompatibility inferred from
  the deployed code and official SDK design, not a claimed production reproduction.
- Independent reviewer approved the complete diff with no blockers. Remaining broad CI
  and production publication are tracked in PR626, not represented as already complete here.
