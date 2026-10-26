# ADR-20261025: Split attendance and explicit overtime rates

- Status: Accepted (business intent and production release authorized by owner 2026-10-25)
- Authority: existing employeeTimesheets; no new collection or migration.
- Related: OPS-STAFF-ATTENDANCE-SPLIT, OPS-STAFF-ATTENDANCE-OT-RATE.

## Decision

Optional workIntervals contain actual start/end times, explicit day offsets and per-interval
break minutes. Net worked minutes exclude gaps. Overnight intervals belong to the date on
which the attendance record starts. Within-schedule net work and outside-schedule overtime
remain independent; missing regular time still requires Paid/NWNP classification.

Optional overtimePayAllocations contain integer minutes and a selected rate of 150 or 200.
Their sum must equal net overtime on explicit save. These are hours at a rate, not multiplied
hours or monetary wage amounts. No automatic policy threshold or historical default is
introduced. Payroll keeps total overtime and adds 150%, 200%, and unassigned columns.

Explicit saves use the existing payroll-role Firestore permissions, authenticated masked
transactions, adjacent-date conflict reads, stale-state rejection and before/after history.
Existing document IDs and unknown fields are preserved. Rate-only edits retain recorded
totals and schedules. Enhanced records retain their schedule snapshot for subsequent edits.
Active absence conflicts require explicit resolution before introducing enhanced records.

Work Order completion discovers canonical and legacy attendance IDs by the existing date
index, rejects duplicate identities and adjacent overlaps, preserves selected rates and adds
only newly evidenced minutes. Newly added overtime remains unassigned for operator review.

## Alternatives and consequences

- A single 08:00–05:00 range would invent work during the off-duty gap: rejected.
- Backfilling old overtime as 150% would invent a payment decision: rejected.
- A separate attendance collection would split payroll truth: rejected.
- At most 12 intervals / 24 rate allocations; history is append-only with a conservative
  size guard. Operators must review stale saves rather than silently merge financial edits.
- The old ordinary absence synchronization remains a separate write after guarded attendance
  saving; its existing failure/retry behavior is retained, with overlap rejection before writes.
- Browser tests use synthetic adapters and block nonlocal requests; no employee data is used.

## Rollout and recovery

Publish compatibility for workOrderApplication before the ERP UI. Preserve live runtime
configuration, IAM and all unrelated source files with a source-only update. No business
function is invoked with authentication during deployment checks. No migration, backfill,
rules, credentials or payroll data are changed by release.

The existing Work Order source has no lockfile. The audit uses one shared validation-only
lock for baseline and candidate, recording its hash. Production dependency declarations and
packaging remain unchanged; this does not prove identical resolved versions to the running
revision. Validate the exact candidate entrypoint and anonymous boundary after publication.

Forward recovery must retain support for saved interval fields. Do not roll back to an
interval-unaware writer. Keep immutable baseline and candidate archives for controlled repair.

## Web transaction correction (2026-10-25)

The initial browser transport incorrectly used a built-in readWrite BeginTransaction
with Firebase web credentials. Replace it with the SDK web optimistic protocol: BatchGet
without a transaction ID, then one Commit containing the masked target write and Verify
preconditions for every read-only adjacent document. Existing records use their raw
updateTime (including sub-millisecond precision); missing records use exists:false.
A conflict rejects the save for explicit refresh/review. A failed response can be retried
through the existing content/history idempotency check. No Rules, IAM, model, backend or
production-data changes are needed. Auth+Firestore emulator tests and browser persistence
with real transport are mandatory regression evidence; mocked transport alone is insufficient.
