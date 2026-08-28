# Employee Profile V2 — Work Schedule Task Contract

Date: 2026-08-27  
Owner / approving human: DEMAC owner/administrator  
Surface: `apps/erp-next` Employees, Attendance, Payroll  
Implementation branch: `feature/employee-profile-v2-schedule-20260827`

## Objective

Replace the employee profile's schedule section with a premium, organized editor that can assign office/non-technical employees an effective 08:00–17:00 or 09:00–18:00 eight-work-hour shift with a one-hour break, while preserving DEMAC's existing employee records and authority boundaries.

## Protected authority map

- Employee master identity remains `staffProfiles`.
- Office/non-technical recurring payroll schedule remains `employeePayrollSettings`.
- Technical recurring half-day remains `vanHalfDaySchedules`; technicians may not receive a duplicate employee-level recurring half-day.
- Dated vacation, sickness and one-off unavailability remain `staffAbsences`.
- Sunday remains globally company-closed.
- Firebase Auth remains an authentication identity, not a second employee master.

## Approved rules / acceptance IDs

### OPS-STAFF-SCHEDULE-001 — Effective office shift

An office/non-technical employee can follow the company schedule or an individual custom schedule. Supported custom shifts must contain exactly eight worked hours after the break. The primary templates are 08:00–17:00 + 60-minute break and 09:00–18:00 + 60-minute break.

Acceptance examples:
- 08:00–17:00 with 60-minute break = 8 scheduled work hours.
- 09:00–18:00 with 60-minute break = 8 scheduled work hours.
- A custom schedule does not apply before its effective-from date or after an optional effective-until date.

### OPS-STAFF-SCHEDULE-002 — Office recurring half-day

The recurring office/admin/operator half-day belongs to `employeePayrollSettings` and pays 4 hours worked + 4 paid-free hours. The weekday is employee-specific and may be Monday through Saturday. Morning-off and afternoon-off variants are supported.

### OPS-STAFF-SCHEDULE-003 — Technical recurring half-day

A field technician's recurring half-day belongs only to the canonical Van/team in `vanHalfDaySchedules` and resolves to 5 hours worked + 3 paid-free hours. Employee payroll settings must not override it.

### OPS-STAFF-SCHEDULE-004 — Employment-date boundary

Generated schedule, assumed attendance and payroll projections must resolve to zero scheduled hours before `employmentStartedAt` and after `employmentEndedAt`. The start date and end date themselves are inclusive.

### OPS-STAFF-SCHEDULE-005 — Sunday closure

Sunday is globally closed and cannot be overridden by an employee custom schedule.

## Data-safety / migration impact

No migration or production backfill is required. New schedule fields are optional and additive on the existing `employeePayrollSettings` document. Legacy records that contain only the existing half-day fields continue to resolve exactly as before. Updates use Firestore update masks, preserving unrelated fields in existing real employee payroll records. Historical `staffProfiles`, `employeeTimesheets`, `staffAbsences`, payroll settings and lifecycle records are not deleted or rewritten by this feature.

## Verification required before PR / merge

- `npm run typecheck --prefix apps/erp-next`
- `npm run test:employee-schedule --prefix apps/erp-next`
- `npm run build --prefix apps/erp-next`
- Diff review for employee identity, authority, and data-preservation regressions.
- Manual preview of existing legacy office record, custom 09:00–18:00 office record, technician inherited Van half-day, Sunday closure, and an employee with a mid-period employment start date.

No production deployment, migration, PR, or merge is authorized by this task contract.
