# Task: record a continuous overnight shift and its daily planned schedule

## Context and scope

Owner incident2026-10-26: ordinary attendance15:00 onOct20 through05:00 onOct21,
zero actual break, manually200% overtime, cannot be saved. Planned shift15:00–00:00
includes60m break. Screenshot shows old recurring08:00–17:00 and no next-day option.
Repair the ordinary single-interval form and dated schedule window; preserve existing data.
Owner merge/deploy authorization continues. No production employee is a test fixture.

## Governance

Deep Review: payroll/write-model/security validation, authority employeeTimesheets.
OPS-STAFF-ATTENDANCE-DAILY-SHIFT, SPLIT, BREAK-END and OT-RATE apply. No new collection,
recurring schedule changes, backfill, role expansion or employee-data release writes.
The adjusted shift preserves canonical/saved net regular minutes and paid-free entitlement.

## Acceptance

- Explicit next-day ClockOut for one continuous interval; split remains two or more intervals.
- Dated planned start/end/next-day/break; actual break remains separate.
-840 worked,480 regular,360 OT; manual200% preserved after save/reload/WorkOrder evidence.
- Same-day/next-day offsets, missing time, overlaps, rates, reasons and optimistic writes validated.
- Existing history/unknown metadata preserved; lost-response creates/updates are idempotent.
- Existing clients cannot rewrite adjusted records without increasing the revision and retaining
  a coherent schedule snapshot. Payroll role read/create/update and admin delete unchanged.

## Verification and rollout

Shared calculation, domain persistence, WorkOrder, Auth/Firestore emulator and desktop/mobile
real browser gates. Typecheck/build and independent adversarial review required. Production
checks are source/metadata/read-only; synthetic tests never connect to production.
Read-only audit freezes exact live backend source/config/IAM/traffic and Rules hash. Release
updates only two runtime modules, then the narrow Rules guard, then frontend. No business
function invoked with a privileged principal. Recovery is forward: retain override/revision
support and guard after new entries exist. Never restore an old client/backend or old Rules
that could discard/recalculate new records. Final evidence is tracked in the review and PR.
