# Review: Employee Profile V2 / Work Schedule

> Builder review only. This record does **not** satisfy the repository's independent Reviewer requirement.

## Scope reviewed

- Request/acceptance criteria: premium editable employee profile; individual office 08:00–17:00 / 09:00–18:00 schedules; variable office half-day 4h worked + 4h paid free; technical half-day 5h worked + 3h paid free from Van/team; Sunday closed; employment start/end boundaries; preserve real employee data.
- Diff/commit: `34f4c3b3b541a7fe99bfc24b5234fb85ddb16f53..ee6f5491a3a3ea5a9aebd90399a8bda6b894b6af`
- Authorities and rule IDs: `staffProfiles`, `employeePayrollSettings`, `vanHalfDaySchedules`, `staffAbsences`; `OPS-STAFF-SCHEDULE-001` through `OPS-STAFF-SCHEDULE-005`.

## Findings

| Severity | Location | Evidence and impact | Required correction |
| --- | --- | --- | --- |
| High | Initial premium profile draft | Existing ERP access creation/disable and employment lifecycle controls had been simplified, creating a functional regression risk. | Corrected in `employee-profile-editor-v3.tsx`; existing access create/link/disable, password setup, offboarding, and reactivation flows are retained. |
| Medium | Initial Vercel preview | Two TypeScript errors blocked build. | Corrected; current `typecheck`, employee schedule acceptance test, and production build pass. |
| Medium | Employee schedule history | A new future schedule could have changed how earlier dates were interpreted if only the latest fields were stored. | Added effective `scheduleVersions`; first V2 save captures a legacy baseline and tests verify historical dates retain the previous schedule. |
| Low | Preview interaction | Vercel preview is protected by authentication, preventing unauthenticated tool-driven click testing of the employee modal. | Keep manual authenticated visual/interaction review as a pre-PR gate; no production write is required. |

## Verification

- Checks independently run: **None. Independent Reviewer still required.**
- Builder checks run by Vercel at commit `ee6f5491a3a3ea5a9aebd90399a8bda6b894b6af`:
  - `npm --prefix apps/erp-next run typecheck` — PASS.
  - `npm run test:employee-schedule` through ERP Next `prebuild` — PASS.
  - `npm --prefix apps/erp-next run build` — PASS.
  - Both Vercel project checks — SUCCESS.
- Employee schedule acceptance coverage:
  - legacy office half-day compatibility;
  - custom 09:00–18:00 + one-hour break;
  - office 4h worked + 4h paid-free half-day on custom shift;
  - effective-from / effective-until behavior;
  - Sunday cannot be overridden;
  - employment start date prevents synthesized days before employment;
  - technician schedule ignores employee payroll schedule and inherits Van half-day 5h + 3h;
  - additive save preserves legacy payroll metadata;
  - first V2 save preserves legacy historical schedule version;
  - protected write rejects individual technician recurring schedule.
- Security and permission cases:
  - Firestore `employeePayrollSettings` remains restricted to payroll roles (`admin`, `accounting`).
  - No Firestore security-rule changes were made.
  - UI continues to require payroll-sensitive authorization for individual office schedule editing.
- Retry/failure/recovery cases:
  - No destructive migration/backfill exists; rollback is branch/code rollback.
  - Existing schedule fields remain readable as compatibility fallback.
  - Existing payroll-setting documents are updated with Firestore update masks, preserving unrelated fields.
- Unverified areas:
  - Authenticated manual visual interaction of the final premium profile.
  - Independent Reviewer pass.
  - PR-level integration checks (PR intentionally not created yet at owner's request).

## Decision

- [ ] Approve
- [ ] Approve with recorded follow-up
- [x] Request changes / additional gates before merge

Current code gates are green, but the change is **not READY FOR MERGE** until the final visual review/screenshot is completed, an independent Reviewer records approval, and PR-level checks are green. No merge or production deployment is authorized by this review.
