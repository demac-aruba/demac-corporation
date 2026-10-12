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
and deploy the additive read action with the frontend through the bounded
release process below. An old backend gives an explicit history-load error while the
operational board remains usable. Frontend rollback removes notes; no data rollback
or migration is necessary.

### Owner-approved publication preparation, 12 October

Owner explicitly approved merge and deploy in this conversation. All nine original
PR checks passed. Current main remains `0dc09f3`. The live frontend on the verified
`demac-aruba.com` project is deployment `dpl_56YCZgumwiVymoskkt79Shb13ycW`, source
`e304c05e51322bfc21e20aa85aefa5e7325d43cf`; its entire ERP Next subtree equals main.
Thus the reviewed frontend retains the published payments overview. PR572 and
PR574 remain open and are excluded.

Release inspection found that a normal main push also runs the generic WhatsApp
deployment, queue migration and Van-group realignment. Those are outside this
request. Merge with `[merge-only]`, then use `schedule-history-release.yml` on the
dedicated release branch. It downloads the current versioned Office bundle,
requires the exact previously audited running application manifest, and applies
only the reviewed `officeBookingAuthority.js` hunk plus `bookingScheduleHistory.js`.
All other source files, dependencies, configuration and IAM remain byte/hash bound.
No other function, scheduler, data migration or message operation is invoked.

This release adapter received a separate Solo Maintainer Adversarial Review
(not independent): challenged stale source/main, concurrent publication, patch
scope, secret exclusion, live-client isolation, uploaded recovery, reversible patch,
archive extraction and final published-source/configuration/IAM proof. The baseline
and candidate run the existing Office, lifecycle, communications and saved-booking
emulator suites from the actual deployed bundle, plus the new read tests and real
history emulator. Unknown runtime source blocks release instead of replacement.
No dependency reconstruction is authorized or implemented by this adapter.

The earlier PR574 logging/scaling finding concerns another function and remains
unresolved in that PR; this release does not attempt to repair it or claim its audit
passed. No production authenticated booking or message send is needed for this
read-only feature. Recovery is the uploaded tested Office baseline; restore only
if its revision/configuration lease is still valid. Frontend publication follows
successful backend verification and uses the exact reviewed merged source.

### Concurrent main reconciliation

While the release gates ran, owner-approved QuickBooks sandbox PR575 merged as
`f1700b0d1ee08b1b14289d1249ea9237ecfde287`. Merged that main into this feature without
conflicts. The only shared frontend file is package.json; both test commands remain.
The release adapter now pins the exact integrated functions/ERP trees. The deployed
Office patch remains exactly the original two-file history change, so the separate
QuickBooks backend is neither replaced nor redeployed. Publication includes the
already approved QuickBooks frontend and preserves its integration entry point.

The first actual-source audit, run 38315909907, passed 503 baseline and 503 patched
regressions plus six history checks; recovery artifact 11776925314 and evidence
11776870392. Exact integrated-head CI/audit must pass before merge; this evidence
does not waive the new checks.
