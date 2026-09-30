# Task: Classify partial-day no-work time without unused lunch credit

## Context, scope and governance

- Owner request: general rule for any employee working a partial regular day; example
  13:00–16:00, break 0 on an eight-work-hour schedule. Actual work 3h, no work 5h, OT 0.
- Baseline `246814113274bc50f4eda2d8795568ae82ae6b3b`; Deep Review for payroll changes.
- Scope: shared attendance calculation, additive exception kind, operator notice/payment
  labels, payroll/save regression and documentation. No employee-specific branching.
- Authority: existing resolved schedule and `employeeTimesheets`; no new collection,
  permission change, production record update or automatic historical backfill.
- Decision: `../decisions/ADR-20260929-partial-day-no-work.md`.

## Acceptance criteria

- A partial day with no/shorter break earns no unused lunch or early-departure break credit.
- Operator sees net no-work hours and must explicitly choose Paid or NWNP plus reason.
- Paid: 3 actual regular hours + 5 paid no-work hours = 8 payable; unpaid: 3 payable + 5 NWNP.
- Save, edit, repeat save and payroll preserve the distinction; stale classifications
  cannot approve a new partial-day aggregate. Denied/unclassified saves do not report success.
- Preserve completed regular-day skipped-break cases, configured partial-day schedules,
  genuine outside-shift overtime and Work Order replay behavior.

## Verification and risk

- Shared calculation/Work Order tests; ERP save/payroll/attendance acceptance; typecheck;
  production build/prebuild gates; Functions syntax; synthetic browser form verification.
- Separate Solo Maintainer Adversarial Review records exact results and residual gaps.
- No bulk historical correction. Existing records keep stored payment decisions until
  intentionally edited. Rollback does not destructively rewrite approved payroll history.
