# Solo Maintainer Adversarial Review — Employee Partial-Day Exact Hours

Date: 2026-08-27
Branch: `fix/employee-partial-day-exact-hours-20260827`
Task contract: `docs/ai/tasks/employee-partial-day-exact-hours-20260827.md`

## Review verdict

**APPROVE FOR PR / OWNER VALIDATION.** No blocking correctness, authority, data-preservation, or build finding remains in this correction.

## 1. Correctness review

Reviewed the production discrepancy against the final write and read paths.

- Full-day office shifts remain validated as exactly eight worked hours after break.
- The recurring partial day is no longer written into the full-day `weeklySchedule` row, so 09:00–13:00 does not fail the eight-hour full-day validator.
- New partial-day writes store exact Start, End and Break fields and calculate worked duration from those values.
- 09:00–13:00 with no break resolves to 240 scheduled minutes.
- 09:00–14:00 with no break resolves to 300 scheduled minutes, proving the implementation is employee-generic rather than hard-coded to four hours or one employee.
- A partial-day break is deducted from worked time.
- Invalid partial windows with End <= Start are rejected.
- Sunday remains closed.
- Employment start/end boundaries remain intact.

## 2. Authority / architecture review

- `staffProfiles` remains the employee identity authority.
- Office/non-technical recurring partial-day configuration remains in the existing `employeePayrollSettings` authority.
- Technician recurring partial-day authority remains exclusively `vanHalfDaySchedules`.
- The technician employee profile cannot create a competing employee-level rule.
- `staffAbsences` remains date-scoped and separate from recurring partial-day configuration.
- The exact partial-day model is additive; no new competing collection or second source of truth was introduced.

## 3. Payroll integration review

A dedicated acceptance test now passes through `calculatePayrollDay`, not only the schedule resolver.

Expected and verified:
- exact office partial day 09:00–13:00 -> scheduledWorkHours = 4;
- regularHours = 4 when schedule is the source;
- paidFreeHours = 0;
- a standard Mon–Sat 09:00–18:00 week with one 4-hour partial Wednesday resolves to 44 scheduled worked hours.

The generic `paidFreeHours` fields remain readable for explicit historical timesheets and other legacy attendance statuses. This correction does not destructively erase them. Recurring partial-day schedule generation, however, now always contributes zero synthetic paid-free hours.

## 4. Legacy / data safety review

- No migration or backfill is required.
- Existing Firestore employee/payroll documents are updated through update masks.
- Employee IDs are unchanged.
- Existing timesheets, absences and explicit payroll documents are not rewritten or deleted.
- Legacy schedule records without exact Start/End fields remain readable; their stored worked-hours/placement metadata derives the historical worked window.
- Legacy `halfDayPaidFreeHours` metadata may remain physically present in old documents for compatibility, but schedule resolution no longer counts it.
- The deprecated legacy half-day writer was also changed to write zero paid-free hours, preventing an old reachable path from reintroducing the incorrect 4 + 4 rule.

## 5. UI / usability review

- Existing employee Work Schedule shows the exact partial-day Start and End values in the selected weekday row.
- Partial-day Start / End remain editable even when the employee uses the company default full-day schedule.
- The selected partial row displays calculated worked hours rather than `4h work + 4h paid free`.
- Weekly summary reports scheduled worked hours.
- Technician schedule copy reports the exact Van/team worked window and does not mention a synthetic three-hour paid-free block.
- Header save behavior is now tab-aware: while Work Schedule is active it is labeled `Save Work Schedule` and executes the schedule save path, eliminating the prior ambiguity where the visible header button saved only profile data.

## 6. Regression / gate evidence

Latest implementation head before this review passed in Vercel ERP preview:
- ERP Next TypeScript typecheck;
- `employee-schedule-acceptance`;
- `employee-partial-day-payroll-acceptance`;
- optimized Next.js production build.

Both Vercel project status checks on that implementation head reported success.

## Residual / intentionally out of scope

- Explicit historical `employeeTimesheets.paidFreeHours` are not rewritten. If DEMAC later wants a historical accounting-data cleanup, that requires a separately approved audit/migration because those are real records.
- Payroll UI/CSV still has generic legacy paid-free fields for explicit attendance records. Recurring partial-day schedules no longer populate them. Removing those legacy accounting fields globally is a separate business-rule decision and is not required to fix the reported schedule discrepancy.
- Final authenticated click-through in production after merge remains the human validation step for the actual employee data and browser interaction.

## Merge boundary

This review authorizes creation of a PR and technical readiness assessment only. A new explicit DEMAC owner instruction is required before merging this correction to `main`.
