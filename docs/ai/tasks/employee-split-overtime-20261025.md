# Task: Split attendance intervals and explicit overtime pay rates

## Context and authorization
- Owner approved the Employees design and explicitly authorized merge/deployment on 2026-10-25.
- Owner requires preservation of all existing employee records, schedules and historical values. Deployment performs no business-data writes, migrations, backfills or historical rate assignment.
- Deep Review: payroll-relevant calculations and writes, existing employeeTimesheets authority.

## Scope
- Opt-in work intervals with explicit next-day offsets, separate breaks, no paid gaps, overlap validation.
- Explicit 150%/200% overtime allocations; unchanged legacy totals remain visibly unassigned unless an operator chooses a rate.
- Preserve canonical employee/date identities, all existing unrelated fields and Work Order evidence. Retain prior values and operator/reason audit on explicit edits.
- Employees and Payroll Review add rate breakdowns, including exports; existing total columns remain.
- Existing authorization and Firestore payroll roles remain unchanged. No statutory pay-rate policy or monetary wage calculation is introduced.

## Acceptance criteria
- [ ] 08:00–17:00 minus 60m + 19:30–05:00 next day = 480 regular, 570 overtime, 150m excluded gap.
- [ ] Manual rate allocations reconcile exactly to net overtime; rates never create worked hours.
- [ ] Adjacent/overlapping intervals, invalid breaks, incomplete allocations and concurrent edits fail before overwrite.
- [ ] Legacy records and aggregate fields remain unchanged by loading/deployment; explicit prior values remain in audit.
- [ ] Work Order completion preserves split intervals/rates and does not double-count overlaps.
- [ ] Permission-denial, retry, partial-day, midnight and payroll-boundary cases verified with synthetic fixtures.
- [ ] Typecheck, focused/transitive tests, production build, separate adversarial review and deployment verification complete.

## Governance and recovery
- Authority: employeeTimesheets, resolved employee/Van schedule; OPS-STAFF-ATTENDANCE-*.
- Additive fields only; no new collection or identity. Feature fields absent means legacy behavior.
- Runtime rollout must update Work Order compatibility before exposing interval saves in frontend.
- Rollback must keep support for already-saved interval records; do not roll back to a writer unaware of these fields.
- No real employee record is used as a test fixture or modified during verification.

## Verification
Pending implementation and focused checks. This task file is not a claim of release completion.
