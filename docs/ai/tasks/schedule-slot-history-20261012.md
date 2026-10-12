# Scheduling slot history — 2026-10-12

Owner request: cancellation/rescheduling must leave a visible, inspectable trace in
the original Van/time while that capacity remains available for new bookings.
Mode: Fast Product Validation. Base: main `0dc09f3167150ed775018a6f257542961b21cddf`.

## Delivered behavior

- Notes show cancellation, customer reschedule or operational move, original time,
  customer and count of additional events. They remain on reoccupied/conflicting
  cards and closed capacity; recorded changes outside displayed hours are retained
  below the Van's slots.
- Separate history button opens the recorded origin/destination, reason, note,
  actor/time, original booking creation metadata and appointment reference.
  Current service/CRM labels are identified as appointment metadata, not fabricated
  snapshots of old service scope. Unknown details remain explicitly unrecorded.
- Existing Book/Support/drag/detail paths remain authoritative. History does not
  enter jobs, locks, occupancy metrics, payroll or communication queues.

## Read boundary and performance

`list_schedule_history` is an additive read on the existing Office Booking API,
behind its authenticated active-office-role gate and existing facade delegation.
No write handler, access rule, collection, migration, secret or production record
changes. Existing Appointment lifecycle history is the only source.

Initial session load reads sparse rescheduled/cancelled timestamp indexes, 50
appointments per page, with a field mask and deterministic timestamp/document-ID
cursor. This intentionally covers old source dates after an appointment moves
outside the visible week. The board does not await history. Cursor completion is
explicit; there is no silent first-page cap.

Subsequent 60-second/focus refresh uses `updatedAt` (Firestore server commit time),
with a server-time checkpoint and one-minute overlap. Full reconciliation runs on
explicit refresh and local lifecycle outcomes. IDs deduplicate overlap. Failed
pages never advance the checkpoint, failures remain visibly incomplete, and an
aborted/revoked session cannot restore cached history. This is a read cache only.
Initial cost grows with changed appointments; no all-appointment scan is added to
the 15-second operational refresh. No live latency/volume claim is made.

## Historical limitations

- Only recorded canonical lifecycle events can be displayed. Older writes lacking
  both lifecycle evidence and its cancellation/reschedule timestamp are not guessed
  or retroactively rewritten.
- Old support snapshots often lack an end time; only their recorded start is marked,
  with an explicit missing-end label. Current assignments never fill historical gaps.
- Older operational move snapshots may not have a separate capacity-end field;
  their recorded interval is shown. No inference of unrecorded overtime capacity.
- This feature shows the chronology; it does not assert that every changed booking
  was already present at the start of the workday.

## Verification and review

Focused self-review covered final diff, API/facade authorization, read-only query
composition, checkpoint/retry behavior, revoked sessions, historical identity,
capacity isolation and keyboard interactions. React guidance applied to independent
background reads, session isolation, dialog focus and scoped styles.

- 66 backend tests passed: new history projection/auth/pagination plus retained
  Office API, cancellation/reschedule lifecycle and operational-move suites.
- Real Firestore emulator: 54 synthetic changed appointments across three pages,
  timestamp ties, old source dates, read-only updateTime parity and commit-timestamp
  delta after a lifecycle event with an old wall clock. No new collections/locks/messages.
- ERP Next TypeScript passed; live scheduling, drag/Saturday, attribution, card,
  Project label and slot-history projection acceptance suites passed.
- Actual React board/history components at 1440 and 390 px: available/reused slots,
  multiple events, outside-hours notes, history/Book separation, Escape, unchanged
  occupancy, incremental replay, partial failure/retry and session revocation passed.
- Retained scheduling refresh suite: 90 seconds and 900 samples per viewport,
  11 operational refreshes, creator attribution, overtime, Project labels, historical
  week changes, cancellation and session changes passed at desktop/mobile widths.
- Standalone HTML review artifact uses the real compiled board/history components
  with synthetic adapters and no external requests; Book is an illustrative boundary.

All fixtures are synthetic. No live customer data, appointments or messages changed.
Full remote CI/build results are reported separately on the PR; local checks are not
a claim of deployment or production integration verification.

## Release

Not deployed. Owner concept/merge/deploy approval remains required by AGENTS.md.
Before release, reconcile current main and parallel #572/#574, wait for required CI,
and deploy the additive read action with the frontend through the existing approved
release process. An old backend gives an explicit history-load error while the
operational board remains usable. Frontend rollback removes notes; no data rollback
or migration is necessary.
