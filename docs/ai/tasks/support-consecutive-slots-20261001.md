# Task: selectable consecutive coworker support slots

## Context and scope
Owner request 2026-10-01: choose one or more consecutive open slots for any supporting
Van/date. PR #548 enabled date selection but retained a one-slot assignment. Extend the
existing drawer, Office request and linked SUPPORT Work Order; keep one slot as default.
Stop at the first occupied/off slot or clock gap, including lunch. A separate PM support
assignment remains possible. No overtime override, primary job move, payroll, billing,
customer communication, security-rule change or new data authority is introduced.

## Governance
Mode: Deep Review because all selected capacity locks must commit atomically and retries
must not silently change duration. Booking Authority retains commit-time decisions;
Office facade retains role checks. Rules: OPS-SCHED-SUPPORT-001, OPS-TEAM, OPS-ROUTE and
historical acknowledgement/audit. Legacy unchanged. No migration or new source of truth.

## Acceptance criteria
- Default one slot; UI offers every consecutive available duration and displays its end.
- A later occupied slot, half-day limit, lunch gap or end of day prevents extension.
- Server independently validates the whole interval and atomically owns every slot.
- Same-payload retry creates no duplicate; changed duration under an existing request fails.
- Future and explicitly acknowledged historical support preserve existing behavior.
- Desktop/mobile save and reload retain the chosen duration; primary work is unchanged.
- Competing reservations cannot both own an overlapping slot; failed save has no partial writes.

## Verification / recovery plan
Run ERP types, live scheduling acceptance/build, Functions syntax and focused support,
Office authorization, capacity and communication regressions; real Firestore emulator
browser save/reload and contention scenarios. Conduct a separate Solo Maintainer
Adversarial Review. Additive duration uses existing fields. Roll back code if necessary;
existing multi-slot records already use standard duration/slot projections and locks.
Merge and production deployment remain pending owner approval.
