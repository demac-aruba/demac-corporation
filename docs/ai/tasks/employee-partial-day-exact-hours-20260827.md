# Employee Partial-Day Exact Hours — Correction Contract

Date: 2026-08-27  
Owner / approving human: DEMAC owner/administrator  
Surface: `apps/erp-next` Employees, Attendance, Payroll  
Branch: `fix/employee-partial-day-exact-hours-20260827`

## User-reported production discrepancy

After Employee Profile V2 reached production, an existing office employee on a 09:00–18:00 full-day schedule showed Wednesday as a partial day but still displayed 09:00–18:00. The intended recurring worked window is 09:00–13:00. Editing the end time to 13:00 could not be saved because the backend incorrectly validated the partial-day row as an eight-work-hour full day. The UI and schedule model also described the unworked portion as paid-free hours. The DEMAC owner clarified that recurring schedule calculations must reflect the actual hours worked and must not invent or display a paid-free block.

## Corrected authority

### OPS-STAFF-SCHEDULE-001

A full office workday remains an eight-work-hour schedule. The standard templates remain 08:00–17:00 with a 60-minute break and 09:00–18:00 with a 60-minute break.

### OPS-STAFF-SCHEDULE-002

An office/non-technical recurring partial day remains owned by `employeePayrollSettings`, but its authoritative values are the exact partial-day Start, End and optional Break configured by the administrator. The resulting worked duration is calculated from those values. It is not hard-coded to four hours and it does not create synthetic paid-free hours.

Examples:
- 09:00–13:00, no break = 4 worked hours.
- 09:00–14:00, no break = 5 worked hours.
- 09:00–14:00, 30-minute break = 4.5 worked hours.

### OPS-STAFF-SCHEDULE-003

A technician recurring partial day remains owned only by the Van/team. Exact `workdayStart` / `workdayEnd` determine the technician's scheduled worked time. No employee-level override and no synthetic paid-free block are allowed.

## Data safety

- No migration or production backfill.
- No employee IDs are changed.
- No existing timesheet, absence or explicit payroll document is deleted or rewritten.
- New exact partial-day fields are additive on `employeePayrollSettings` and existing documents are updated with Firestore update masks.
- Legacy `halfDayWorkedHours`, `halfDayPaidFreeHours`, and placement fields remain readable for compatibility. Schedule resolution derives the historical worked window but no longer counts legacy paid-free metadata as recurring scheduled time.
- Existing non-partial payroll concepts that use `paidFreeHours` for other explicit statuses are outside this correction and are not globally removed.

## UI acceptance

- The selected partial-day row displays and edits its exact Start / End / Break.
- A partial-day row may be shorter than eight hours and saves successfully.
- Full-day rows still require exactly eight worked hours after break.
- The UI does not say `4h paid free`, `3h paid free`, or equivalent for recurring partial days.
- Weekly preview reports scheduled worked hours.
- While the Work Schedule tab is active, the header action says `Save Work Schedule` and saves the schedule rather than only the employee profile.

## Regression acceptance

- 09:00–18:00 normal day = 8 worked hours.
- Wednesday 09:00–13:00 = 4 worked hours, 0 synthetic paid-free hours.
- Arbitrary valid 09:00–14:00 partial day = 5 worked hours.
- Partial-day break is deducted.
- Sunday remains closed.
- Employment start/end boundaries remain enforced.
- Technician 08:00–13:00 Van partial day = 5 worked hours and cannot be overridden at employee level.
- A future schedule version does not delete the preserved prior schedule metadata or any explicit historical records.

## Required gates before merge

- ERP Next typecheck PASS.
- `test:employee-schedule` PASS.
- ERP Next production build PASS.
- Applicable GitHub Actions PASS on the PR head.
- Vercel preview READY.
- Solo Maintainer adversarial review completed.
- Explicit new owner authorization required before merging this correction into `main`.
