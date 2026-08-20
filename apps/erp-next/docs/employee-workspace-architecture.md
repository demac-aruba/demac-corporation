# Employee Workspace Architecture

## Canonical ownership

The consolidated Employees experience does not introduce a new employee, attendance, payroll, absence, crew, or identity store.

- `staffProfiles` remains the canonical employee master identity.
- `staffAbsences` remains the canonical time-off / unavailability range source used by Scheduling and Attendance.
- `employeeTimesheets` remains exception-driven attendance/payroll input storage. Normal scheduled attendance is derived from the employee work schedule and is not mass-written as daily Present records.
- `employeePayrollSettings` retains payroll-sensitive employee settings and salary-advance records under the existing permission boundary.
- `vans`, `dailyVanAssignments`, and `vanHalfDaySchedules` remain the canonical fleet/crew/schedule sources; Employee Overview only reads them for context.
- Firebase Authentication / managed users remains the sign-in identity system. A login identity never replaces or duplicates `staffProfiles`.
- Employee offboarding/reactivation continues through the existing `employee-lifecycle` domain service so access, future assignments, and historical retention follow one policy.

## UI ownership

`/employees` is the canonical employee workspace with three operational views:

1. **Overview** — complete active/former employee directory, profile editing, add employee, lifecycle controls, and payroll-exception columns when the current role is authorized.
2. **Employee Calendar** — schedule-first attendance and explicit exception entry.
3. **Salary Advances** — payroll-sensitive salary advance ledger and entry.

Legacy URLs remain as redirects only:

- `/employees/attendance` -> `/employees`
- `/employees/payroll` -> `/finance/payroll`

`/finance/payroll` owns restricted payroll/timesheet review and accountant exports. Statutory payroll is not calculated by the ERP.

## Features intentionally owned elsewhere

- Van crew membership and half-day capacity: Vans / Scheduling.
- Dispatch eligibility/readiness and skill evidence: Dispatch Readiness / field-workforce controls.
- Payroll review/export: Finance.
- Authentication permissions: Firebase managed-user / Access Control boundary.
- Commission rules: Settings / commission domain when implemented; do not bury commission rules in the Employee UI.
- Accountant-produced payslips: Finance/payroll document workflow when implemented.

## Retention and migration rule

This consolidation is route/UI/domain-boundary work only. It does **not** migrate, duplicate, rename, or rewrite existing employee IDs or historical records. Former employees remain archived rather than deleted, preserving references from work orders, visits, attendance, payroll inputs, vans, assignments, audit history, and future reporting.
