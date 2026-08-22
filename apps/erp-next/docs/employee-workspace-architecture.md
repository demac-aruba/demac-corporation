# Employee Workspace Architecture

## Canonical ownership

The consolidated Employees experience does not introduce a new employee, attendance, payroll, absence, crew, or identity store.

- `staffProfiles` remains the canonical employee master identity. It does **not** own recurring weekly half-day rules.
- `staffAbsences` remains the canonical dated time-off / unavailability range source used by Scheduling and Attendance. A recurring half-day is not stored as an absence.
- `employeeTimesheets` remains exception-driven attendance/payroll input storage. Normal scheduled attendance is derived from the employee work schedule and is not mass-written as daily Present records.
- `employeePayrollSettings` retains payroll-sensitive employee settings and salary-advance records under the existing permission boundary. For non-technical/office employees it is also the existing canonical source for the employee-specific recurring half-day schedule (`weeklyHalfDayWeekday`, effective date, worked/paid-free hours and morning/afternoon period).
- `vans`, `dailyVanAssignments`, and `vanHalfDaySchedules` remain the canonical fleet/crew sources. For technical field crews, `vanHalfDaySchedules` is the **only** recurring half-day authority; technicians inherit the rule from their Van/team.
- Firebase Authentication / managed users remains the sign-in identity system. A login identity never replaces or duplicates `staffProfiles`.
- Employee offboarding/reactivation continues through the existing `employee-lifecycle` domain service so access, future assignments, and historical retention follow one policy.

## Work schedule authority

Work schedule resolution must be deterministic and must not layer competing weekly rules:

1. **Company calendar** — Sunday is closed. Monday through Saturday use the normal company workday, 08:00–17:00 with lunch 12:00–13:00.
2. **Technical employee** — if assigned to a canonical Van/team, the recurring half-day comes only from that Van's `vanHalfDaySchedules` record. The current field-crew policy is a morning work period (normally 08:00–13:00) with the afternoon off. Employee-specific payroll half-day fields do not override a technician's Van rule.
3. **Office / non-technical employee** — the recurring half-day comes only from that employee's existing `employeePayrollSettings` record. Office half-days are 4 worked hours + 4 paid-free hours and may be either:
   - **Afternoon off:** works 08:00–12:00.
   - **Morning off:** works 13:00–17:00.
   Legacy office records without a period preserve the historical behavior and are interpreted as afternoon off.
4. **Dated exception** — `staffAbsences` can make an employee unavailable for a specific date/range (vacation, sickness, one-off day off, etc.). It never defines the recurring weekly half-day.

The deprecated `weeklyDayOffWeekday` / `weeklyDayOffEffectiveFrom` fields introduced briefly by PR #413 are not runtime schedule inputs and must never be used to make an employee unavailable for an entire recurring weekday. They are neutralized when affected employee records are next saved.

## UI ownership

`/employees` is the canonical employee workspace with three operational views:

1. **Overview** — complete active/former employee directory, profile editing, add employee, lifecycle controls, and payroll-exception columns when the current role is authorized.
2. **Employee Calendar** — schedule-first attendance and explicit exception entry.
3. **Salary Advances** — payroll-sensitive salary advance ledger and entry.

The employee profile is a facade over the existing schedule authorities, not a new schedule store:

- For a **technician**, the profile shows the inherited Van/team half-day read-only and directs editing to **Settings → Weekly Van Half-Days**.
- For **office/non-technical staff**, authorized users may edit the existing individual `employeePayrollSettings` half-day from the employee profile. Saving an old payroll record links it to the current `staffProfiles.id` through `sourceStaffId` instead of creating a parallel employee schedule record.

Legacy URLs remain as redirects only:

- `/employees/attendance` -> `/employees`
- `/employees/payroll` -> `/finance/payroll`

`/finance/payroll` owns restricted payroll/timesheet review and accountant exports. Statutory payroll is not calculated by the ERP.

## Features intentionally owned elsewhere

- Technical crew membership and technical recurring half-day capacity: Vans / Scheduling.
- Dispatch eligibility/readiness and skill evidence: Dispatch Readiness / field-workforce controls.
- Payroll review/export: Finance.
- Authentication permissions: Firebase managed-user / Access Control boundary.
- Commission rules: Settings / commission domain when implemented; do not bury commission rules in the Employee UI.
- Accountant-produced payslips: Finance/payroll document workflow when implemented.

## Retention and migration rule

This consolidation does not rename or duplicate existing employee IDs or historical records. Former employees remain archived rather than deleted, preserving references from work orders, visits, attendance, payroll inputs, vans, assignments, audit history, and future reporting.

Legacy `employeePayrollSettings` documents may predate canonical `staffProfiles` IDs. Schedule lookup first uses `sourceStaffId`/document id and may use a unique normalized employee-name match only as a compatibility bridge. On the next authorized half-day save, the existing payroll settings document is updated in place and linked to the canonical staff id through `sourceStaffId`; a second schedule document is not created.
