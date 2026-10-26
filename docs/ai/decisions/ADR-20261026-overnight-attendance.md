# ADR: dated shift window and continuous overnight attendance

- Status: Accepted
- Date:2026-10-26
- Owner intent: continuous overnight work and manual200% selection; existing deployment authorization.
- Related: overnight-attendance-20261026; OPS-STAFF-ATTENDANCE-DAILY-SHIFT.
- Additive to ADR-20261025-split-attendance-overtime; does not supersede its protections.

## Decision

Use existing employeeTimesheets.workIntervals with one interval for continuous overnight
attendance. A next-day checkbox sets endDayOffset1; do not infer it from an earlier clock.
Only two or more intervals display asSplit. Break Minutes always means actual break taken.

An explicit attendanceShiftOverride(startTime,endTime,endDayOffset,breakMinutes) moves the
regular window for that attendance date. Its net duration must equal canonical/saved scheduled
minutes. Paid-free entitlement is retained; day-off adjustment rejects. Save the planned
snapshot including scheduledEndDayOffset. WorkOrder reconciliation uses the same snapshot
before/after union, retains manual rates, and puts additional uncovered OT at the regular default.

A per-record attendanceShiftRevision starts at1 and increments on real writes. Rules require
next revision, retained override and matching schedule snapshot. Old web clients preserve
unknown fields but fail this guard rather than overwriting with an old calculation. New writer
optimistic commits and audit idempotency remain authoritative. Admin WorkOrder validates and
increments the revision itself; privileged Admin code is outside Rules enforcement.

## Alternatives and consequences

Automatically rebasing regular schedule on actualClockIn would hide tardiness and invent
policy. Treating this asSplit invents a gap or second interval. Altering recurring schedule
would affect unrelated days. A daily shift override keeps intent explicit and narrowly dated.
No migration/backfill or test writes to real attendance. Additional validation protects the
new format without changing roles or unrelated collections. Older sessions must refresh to
edit an adjusted record; existing records without the new model keep their existing workflow.

## Verification and recovery

840/480/360 exact case, break and missing-time boundaries, saved snapshot, manual rate,
WorkOrder retry/union, legacy conversion, stale writers, roles and lost responses are tested.
Deploy backend compatibility and Rules guard before UI. Hold UI publication until at least
ten minutes after the confirmed Rules release updateTime, including resumed releases. Source-only patch preserves function
configuration/IAM/traffic and private recovery source. Rules API lacks CAS; shared production
workflow concurrency and immediate live source/release checks bound its publication window.
Reconcile a lost publication response by reading the live hash; do not blindly rollback.
Once any new record exists, recovery must preserve its model and guard, with a forward repair.
