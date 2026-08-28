# Employee Attendance Payroll Calendar — Task Contract

Date: 2026-08-27  
Owner / approving human: DEMAC owner/administrator  
Surface: `apps/erp-next` Employees → Employee Calendar / payroll attendance  
Implementation branch: `fix/employee-attendance-payroll-calendar-mainline-20260827`

## Context

The current Employee Calendar mixes payroll-period navigation, calendar-month navigation and selected-day state. The top payroll arrows shift the anchor to day 15, which can move September payroll (Aug 27–Sep 26) directly to July payroll (Jun 27–Jul 26) instead of August payroll (Jul 27–Aug 26). Clicking an adjacent-month date also mutates the calendar month even when that date belongs to the active payroll period.

The daily record currently accepts manual overtime minutes and only suggests late overtime after hard-coded 17:00. That conflicts with employee-specific 08:00–17:00 / 09:00–18:00 schedules and does not account for early starts or unused scheduled break time. Missing scheduled time is currently represented only by coarse full/partial Sick, Vacation or Absent hours and cannot preserve separately classified morning, afternoon and extended-break exceptions.

## Scope

### In scope

- Make the canonical payroll period (27th through 26th) the navigation boundary for the Employee Calendar.
- Keep selected date independent from payroll-period identity; an in-period adjacent-month date must not switch payroll periods.
- Render the payroll calendar from the complete 27–26 interval so all dates in the period are visible regardless of weekday alignment.
- Disable surrounding dates that are not in the selected payroll period rather than silently editing another period.
- Derive overtime from the resolved employee schedule plus actual Clock In, Clock Out and Break Minutes.
- Count overtime independently as early start + late finish + unused scheduled break.
- Detect missing scheduled-time segments independently as late arrival, early departure and break taken beyond the scheduled break.
- Require every detected missing-time segment to be classified as Paid or No Work No Pay with a reason before save.
- Preserve each segment and its payroll treatment on `employeeTimesheets` with the existing payroll-sensitive permission boundary and existing audit actor/timestamps.
- Preserve existing full/partial Sick, Vacation and Absent flows.
- Store additive schedule snapshot fields on new/edited explicit attendance records for auditability; no historical backfill.

### Out of scope

- Production deployment or merge to `main`.
- Firestore security-rule changes.
- Destructive migration/backfill of existing employee records.
- New attendance database/collection or new payroll source of truth.
- Changes to Sunday/office/technician recurring schedule ownership or exact partial-day schedule rules.
- Defining a new policy for work performed on a day with zero scheduled shift.

## Governance

- Employee identity authority: `staffProfiles`.
- Dated full-day unavailability authority: `staffAbsences`.
- Office/non-technical recurring payroll schedule: `employeePayrollSettings`.
- Technical recurring partial day: `vanHalfDaySchedules`.
- Explicit payroll attendance exception authority: existing `employeeTimesheets` interpreted against the canonical `resolveEmployeeSchedule` result.
- Security/privacy impact: payroll-sensitive data only; no access expansion. Existing Firestore rules restrict `employeeTimesheets` to payroll roles.
- Legacy parity impact: no Legacy implementation is copied; this is an ERP Next domain correction.
- ADR/debt impact: no new source of truth and no architectural replacement; no ADR required unless implementation uncovers a conflicting authority.

## Approved rule IDs

- `OPS-STAFF-ATTENDANCE-001` — Payroll-period calendar navigation and date membership.
- `OPS-STAFF-ATTENDANCE-002` — Deterministic schedule-derived overtime.
- `OPS-STAFF-ATTENDANCE-003` — Independent paid/NWNP classification of partial missing scheduled time.
- `OPS-STAFF-ATTENDANCE-004` — Additive explicit-attendance schedule snapshot for audit.

## Acceptance criteria

- [ ] September payroll (Aug 27–Sep 26) → one previous action = August payroll (Jul 27–Aug 26); another previous action = July payroll (Jun 27–Jul 26).
- [ ] August payroll displays and permits selection of Jul 27 without changing the payroll period or calendar label from August.
- [ ] Every date Jul 27–Aug 26 is present/selectable in August payroll; surrounding cells are visible only as context and cannot silently create/edit another payroll period.
- [ ] Schedule 09:00–18:00, 60-minute break: 09:00–18:00/60 = 0 OT; 08:00–18:00/60 = 60m; 09:00–18:30/60 = 30m; 08:00–18:30/60 = 90m; 09:00–18:00/30 = 30m; 09:00–18:00/0 = 60m.
- [ ] Overtime cannot be manually overridden in the canonical Employee Calendar and is not netted against missing scheduled time.
- [ ] 09:00–18:00 employee working 11:00–16:30 with normal break creates separate 09:00–11:00 late-arrival and 16:30–18:00 early-departure segments.
- [ ] Scheduled 60-minute break with 90 minutes taken creates a separate 30-minute extended-break missing-time segment.
- [ ] Each detected missing-time segment requires Paid or No Work No Pay plus non-empty reason; save fails deterministically when classification is incomplete.
- [ ] Paid missing segments contribute to paid-free time; unpaid missing segments contribute to No Work No Pay; regular worked scheduled hours and overtime remain separate.
- [ ] Existing exact office/technician recurring partial-day schedules continue to count actual worked time only with zero synthetic paid-free schedule hours.
- [ ] Full/partial Sick, Vacation and Absent behavior remains backward compatible.
- [ ] Explicit attendance writes remain deterministic per employee/date and preserve actor/timestamp audit fields.
- [ ] No Firestore permissions, production data or deployment configuration are changed.

## Failure / recovery

- Invalid or reversed Clock In/Clock Out is rejected before persistence.
- Incomplete partial-exception classification is rejected before persistence.
- Existing legacy timesheet documents without the additive exception/snapshot fields continue to load.
- The change is rollbackable by reverting the feature branch/PR; no migration is required.

## Verification

Required before merge readiness:

- `npm run typecheck --prefix apps/erp-next`
- focused attendance acceptance test covering navigation math, overtime and segment classification
- existing `npm run test:employee-schedule --prefix apps/erp-next` including exact partial-day payroll acceptance
- `npm run build --prefix apps/erp-next`
- complete diff review against current `main`
- Solo Maintainer Adversarial Review (or qualified independent review if available), recorded separately
- PR checks green against current `main`

No production deployment or merge is authorized by this task contract.