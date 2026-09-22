# Task: Current Project slot budget and chronological booking detail

## Context and scope
- Owner requests a slot progress bar, red over-budget amount, technician/date detail and automatic reflection of backdated corrections. Field is not operational for this workflow.
- Deep Review: read projection crosses Project links, Booking Authority and payroll-sensitive attendance. No new source of truth, persistence, write path, access policy or Field integration.
- Use the existing Van-slot budget: one occupied Van slot is counted once regardless of crew size. The owner has been asked to confirm whether a different technician-slot metric is intended; no new labor multiplier is inferred.
- Start from production a5cd9139; preserve the combined Property and Scheduling release. Unreleased main overtime is excluded from the release candidate.

## Authorities and acceptance criteria
- Booking Authority / workOrders owns current slots, date, Van, cancellation and recorded assigned crew. Exact existing Project links plus Customer/Property/Appointment identity are mandatory. No name matching or current Van crew substituted for historical crew.
- Projects' existing estimatedSlots owns the advisory baseline. Slot use is allocation, not physical completion or actual labor. Browser-only phase previews are explicitly excluded from live totals.
- employeeTimesheets owns explicit attendance. It is read only with payroll_sensitive.view and existing Firestore authorization; no missing entry becomes confirmed attendance. Attendance is day-level, not proof of work at this Project.
- Re-read current Work Orders by exact IDs on mount, return to tab, refresh and periodic refresh. Replace totals, including additions/removals/cancellations/date or slot corrections. No incrementing or changing browser counters.
- Duplicate links count once. Conflicting Project/identity claims, permission/network failures and invalid slots produce an incomplete total, never a false verified zero. A confirmed missing Work Order is visibly removed and contributes zero.
- Details sort ascending date/time and show Van, slots, assigned crew and explicit attendance status where authorized.
- OPS-SVC, OPS-TEAM, OPS-SCHED and OPS-STAFF-ATTENDANCE behavior is unchanged. Historical write guards and communications remain untouched.

## Verification plan
- Pure projection: under/at/over budget; duplicate links; retrospective add/reduce/remove/cancel/move; missing and conflicting identity; malformed storage; incomplete reads; crew and attendance corrections; no technician multiplication.
- Reader: bounded direct reads, capability denial before transport, payroll denial makes no attendance request, partial failures surfaced.
- Real React synthetic browser: populated bar, red amount, chronological details, refresh corrections, recovery, permissions, stale responses, desktop/mobile.
- ERP typecheck, Projects and Scheduling focused gates, release build. Separate solo adversarial review before merge/deploy; no claim of independent review or verification of private production records.
- Rollback is frontend-only to prior a5 deployment; no database or browser records migrated.
