# Task: Save continuous-work shifts with an earlier departure

## Context and scope

- Owner request, 2026-09-28 Aruba time: for an 08:00–17:00 shift with one hour of
  scheduled break, break 0 and departure at 16:00 / 16:30 / 17:00 must yield
  0 / 30 / 60 overtime minutes and eight regular hours, without missing-time classification.
- Evidence: the calculator credited all skipped break as overtime and separately
  classified early departure; the UI also suppressed zero-overtime shifted days.
- Baseline: `main` at `53b47592bfcd8993c987514bd755a92ee5e95850`.
- Deep Review because this changes payroll amounts. Scope: shared attendance calculator,
  Employee Calendar save eligibility/explanation, regression evidence and rule documentation.
- Out of scope: late-arrival policy, generalized overtime netting, scheduling/CRM,
  production records, security rules, deployment and migration.

## Governance

- Authority: canonical resolved schedule plus explicit `employeeTimesheets` exceptions.
- Rule: `OPS-STAFF-ATTENDANCE-BREAK-END`; the owner's new instruction supersedes the
  previous blanket no-offset rule only for unused break applied to early departure.
- No new authority, collection, permission, actor identity or persisted schema.
- Legacy UI untouched; shared backend Work Order overtime calculation receives the same rule.
- Decision: `../decisions/ADR-20260929-attendance-break-at-end.md`.

## Acceptance criteria

- Required three departures retain real clocks/break and produce eight regular hours.
- A zero-overtime shifted day can be saved without artificial notes.
- Partial break uses only remaining allowance; uncovered missing time still requires a
  treatment and reason, with accurate interval boundaries.
- Late arrival, early/late outside-shift overtime, no-break partial schedules and external
  Work Order evidence retain their independent treatment.
- Save, payroll projection, deterministic retry, stale classification removal and errors
  are exercised against synthetic fixtures; existing actor/schedule audit fields remain.

## Plan, risks and verification

- Apply skipped break before bounding early-departure minutes. Exclude wholly outside-shift
  attendance. Expose the applied amount and preserve actual time changes as explicit records.
- No backfill or bulk recalculation. Previously saved totals remain until explicitly edited
  or processed by an existing recomputation path. Roll back by reverting code; any records
  saved after release need explicit review, never automatic destructive reversal.
- Gates: shared calculator + Work Order tests; ERP attendance/save/payroll, schedule and
  Work Order acceptance; ERP typecheck/build; Functions syntax; complete adversarial review.
- Exact results and residual gaps are recorded in the companion review.
