# Review: Employee Profile V2 / Work Schedule

## Scope reviewed

- Request/acceptance criteria: premium editable employee profile; office/non-technical 08:00–17:00 and 09:00–18:00 schedules with one-hour break; variable office half-day 4h worked + 4h paid free; technician half-day 5h worked + 3h paid free governed by Van/team; Sunday closed; employment date boundaries; preservation of existing employee data and existing profile capabilities.
- Diff/commit reviewed: `34f4c3b3b541a7fe99bfc24b5234fb85ddb16f53..5fca033168122cc82afaa3c430f905e3555d1cf5`
- Authorities and rule IDs: `staffProfiles`, `employeePayrollSettings`, `vanHalfDaySchedules`, `staffAbsences`; `OPS-STAFF-SCHEDULE-001` through `OPS-STAFF-SCHEDULE-005`.
- Reviewer pass was performed after implementation was frozen for review; no implementation code was authored during this review pass.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| Medium | Premium profile access/lifecycle parity | Earlier builder review identified a risk of losing existing access/lifecycle capabilities. Current reviewed code retains create/link/disable ERP access, password setup/reset, offboarding and reactivation using the pre-existing governed services. | Corrected before this reviewer pass; no further action. |
| Medium | Operational employee type vs ERP permissions | Earlier implementation could have reset ERP access role/email ownership when changing employee type, violating separation of operational role and authentication authority. | Corrected before this reviewer pass. Current employee-type editor preserves ERP access-role and login-email ownership state. |
| None blocking | Schedule authority and data preservation | Current implementation extends the existing `employeePayrollSettings` authority; technician half-days remain Van-owned; Firestore updates use update masks; no migration/backfill/destructive operation is introduced. | None. |

## Verification

- Checks independently reviewed/run as evidence for commit `5fca033168122cc82afaa3c430f905e3555d1cf5`:
  - ERP Next TypeScript gate — PASS.
  - `test:employee-schedule` — PASS.
  - ERP Next production build — PASS.
  - Vercel `demac-corporation` — SUCCESS.
  - Vercel `demac-corporation-web` — SUCCESS.
- Acceptance test coverage reviewed:
  - legacy office half-day compatibility;
  - custom 09:00–18:00 schedule with one-hour break = 8 worked hours;
  - office half-day on custom shift = 4 worked + 4 paid-free hours;
  - effective-from / effective-until behavior;
  - Sunday closure cannot be overridden;
  - employment start date prevents synthesized schedule days before employment;
  - technician payroll settings cannot override Van/team schedule;
  - technician half-day = 5 worked + 3 paid-free hours;
  - additive save preserves existing legacy payroll metadata;
  - first V2 save retains a historical legacy baseline;
  - historical dates continue resolving against prior schedule versions;
  - protected write path rejects individual technician recurring schedules.
- Security and permission cases:
  - `employeePayrollSettings` remains protected by Firestore `payrollRole()` (`admin` / `accounting`).
  - No Firestore rules were changed.
  - UI schedule editing continues to require owner/admin or payroll-sensitive authorization.
  - Employee master identity remains `staffProfiles`; Firebase Auth is not used as a duplicate employee master.
- Retry/failure/recovery cases:
  - No production data migration is required.
  - Existing records are not deleted or bulk rewritten.
  - Existing payroll documents are updated through field masks, preserving unrelated real fields.
  - Rollback is code/branch rollback; legacy schedule fields remain readable as compatibility fallback.
- Unverified areas:
  - Authenticated click-through visual review of the Vercel preview is blocked from this tool environment by preview authentication.
  - PR-level checks have not run because the owner requested the final screenshot before PR creation.

## Decision

- [ ] Approve
- [x] Approve with recorded follow-up
- [ ] Request changes

Follow-up before PR: show the owner the final premium Employee Profile / Work Schedule screenshot and complete the visual acceptance checkpoint. After that, create the PR and require its integration checks to remain green before declaring **READY FOR MERGE**.

Residual risk: visual interaction/layout only; no known blocking domain, data-preservation, authorization, type, schedule-test or build defect remains in the reviewed commit. Owner: DEMAC owner/administrator. Due: before PR creation.
