# Task: default regular overtime to 150%

## Context and scope

Owner clarification 2026-10-26: all ordinary overtime is 150%; 200% is manual only.
The reported breakdown is 47h25 total, 9h30 selected at 200%, and 37h55 without a rate.
Expected result: 37h55 regular at 150% plus 9h30 special at 200%, with total unchanged.
Existing merge/deploy authorization continues. Preserve real employee records and history.

Deep Review applies because payroll classification and the split save path are affected.
Authority remains employeeTimesheets; rule OPS-STAFF-ATTENDANCE-OT-RATE is clarified in
BUSINESS_RULES and the split ADR. No new authority, migration, Rules/IAM/backend deployment,
employee data writes or automatic late-night/holiday threshold is part of this release.

## Acceptance and implementation

- Project remaining valid overtime at 150% for missing/empty/partial historical allocations.
- Keep every explicit 200% minute; malformed/excess allocations remain review-required.
- New split saves use 150% without a manual selection; explicit selections must match OT.
- Interval edits preserve selected rates and require correction if the total changes.
- Employees, Payroll, both CSV exports and PDF use regular 150% / special 200% columns.
- Remove the ordinary unassigned category; retain conflict warnings and compatibility metadata.
- Preserve times, IDs, unknown fields, history, permission boundaries and idempotent retries.

## Verification and recovery

Shared calculation tests, attendance/save/transaction acceptance and typecheck pass locally.
Acceptance includes the exact owner totals across separate historical records, read immutability,
default split save/retry, preservation of 200%, mismatched-duration rejection and PDF content.
PDF rate page was rendered and visually inspected with a synthetic employee.
Production build, independent review and desktop/mobile authenticated browser CI are release
gates; their final results are recorded in the review/PR. Browser fixtures use only synthetic
demo data and unchanged Firestore Rules; no production request or employee write is permitted.

Recovery is a frontend forward fix retaining the split-aware writer. No data rollback is
necessary because this change does not backfill historical records. Existing explicit
selections continue to be authoritative. Historical partial selections still require a
complete explicit allocation when deliberately editing their rate.
