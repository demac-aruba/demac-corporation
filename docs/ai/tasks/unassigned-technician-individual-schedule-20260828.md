# Task — Unassigned technician individual schedule

## Request
Give technical employees the same premium Employee Profile schedule experience as office staff when they are not assigned to a canonical Van. Preserve current behavior for Van-assigned technicians: their recurring partial day remains inherited automatically from the Van/team.

## Authority boundary
- Employee identity remains `staffProfiles`.
- Regular Van crew remains owned by `vans`.
- Van-assigned technical recurring partial day remains owned by `vanHalfDaySchedules`.
- A technical employee with no canonical Van assignment may use the existing `employeePayrollSettings` schedule authority for an individual schedule. This is not a new source of truth.
- If that employee later becomes part of a canonical Van crew, Van/team schedule resolution takes precedence without deleting the employee's historical/versioned individual schedule.

## Acceptance criteria
1. Van-assigned technician/helper remains read-only in Work Schedule and shows the assigned Van/team as the protected schedule source.
2. Unassigned technician/helper gets the premium editable schedule UI used by office employees.
3. Unassigned technical schedule may use company/default or custom full-day hours plus one exact recurring partial-day window, with effective dates/history.
4. Calendar, Attendance and Payroll resolve the individual schedule only while the technical employee has no canonical Van.
5. Assigning the employee to a Van immediately makes the Van/team schedule authoritative; moving them to another Van changes the inherited recurring partial day automatically.
6. Removing the employee from all Vans makes the saved individual schedule active again for applicable effective dates.
7. Sunday remains company-closed.
8. No migration, backfill, destructive data change, duplicate employee schedule collection, or `primaryVanId` authority is introduced.

## Required gates
- Employee schedule acceptance
- Employee partial-day payroll acceptance
- Van schedule architecture
- ERP Next typecheck/build
- Solo Maintainer Adversarial Review

## Human boundary
Do not merge to `main` or deploy production without explicit DEMAC owner approval.
