# Review: regular overtime default at 150%

## Review mode and scope

- Independent Review: /root/attendance_review; implementation: /root.
- Reviewed implementation: PR627, 5d14a14b300c830bed58e2c55cfe913be331e36f.
- Local complete tree equals remote tree 7ab41ceb9cd763f6794c2c15228a205e37966c12.
- Surfaces: shared read projection, split editor/save, Employees/Payroll, all CSV and PDF.
- Authority: employeeTimesheets; OPS-STAFF-ATTENDANCE-OT-RATE. No authority or role changes.

## Findings and corrections

| Severity | Finding | Resolution |
| --- | --- | --- |
| Medium | Employees accounting CSV lacked the rate breakdown shown on screen. | Appended regular 150%, special 200% and review flag; original columns retained. |
| Medium | Allowing empty historical allocations also skipped malformed non-array values. | Only nullish/empty arrays bypass validation; non-arrays reject before writing. Editor keeps a warning and requires explicit valid selection. Regression reproduced and fixed. |

The reviewer inspected the complete diff and subsequent corrections. No code blockers remain.
Explicit 200% minutes are retained, valid remainder defaults to 150%, and malformed/excess
allocations remain visible for review. Historical records are never backfilled by reads.

## Verification

- Shared calculation tests: 10/10 PASS, independently repeated.
- Attendance/save/transaction acceptance: PASS, independently repeated after corrections.
- Local typecheck and production build/prebuild gates: PASS.
- Real Auth/Firestore emulator roles, stale changes, neighbor races, role revocation and
  lost-response retries: PASS; unchanged production Rules, zero production requests.
- Exact owner example across records: 47h25 = 37h55 regular + 9h30 special; input immutability,
  default split save/retry, manual rate preservation and malformed-data rejection pass.
- Synthetic PDF rendered and visually inspected. Desktop/mobile screenshots inspected.
- Initial authenticated browser CI 40260608070 PASS; artifact 12624218495 verifies default
  save, manual split/200%, persisted reload, immutable history fixture and changed-duration block.
- The added malformed-data browser fixture initially seeded an undefined document ID:
  Firestore stores identity in the path, not in saved fields. Corrected the fixture to use
  its known path and verify the seeded shape; the mandatory test remains enabled.
- Final code CI additionally covers the downloaded Employees CSV and malformed-rate UI
  recovery. Green final-head browser/build checks remain mandatory before merge/deploy;
  exact final results and publication evidence are recorded in PR627.
- React checklist: derived defaults without extra state/effects, labelled controls, retained
  keyboard/native input behavior, review alerts, no new dependency/fetch or permissions.

## Decision and limits

PASS for code review, subject to final-head CI gates. No production employee was used for
testing or altered during release. Production acceptance is limited to read-only served-asset
verification; authenticated save acceptance uses synthetic emulators to preserve real data.
Existing explicit partial allocations require a complete valid selection when edited.
Owner authorization for merge/deploy remains in the conversation. Recovery is frontend-only
forward repair; do not discard the existing split-aware writer or mutate historical records.
