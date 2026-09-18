# Adversarial self-review: atomic Projects booking handoff

Mode: Deep Review / Solo Maintainer Adversarial Review by implementation author ChatGPT.
Not an independent review. Scope: new Project adapter and tests; Booking Authority integration;
Office forwarding/default activation; existing consumers, replay paths and lifecycle readers.

## Findings resolved before publication

1. Firestore orders map keys, so JSON.stringify equality would incorrectly reject a valid
   reused offer. The five bound context fields are compared explicitly; regression added.
2. An early booking receipt return could bypass newly added access checks. All three receipt/
   existing-appointment return paths now validate the actor and Project link read-only.
3. Treating deactivation as a rejection for a previously completed retry could provoke a
   replacement booking. New writes remain disabled, while authorized exact replay validates
   existing identity without imposing a now-stale plan version or new-booking status.
4. Comparing historical WorkOrder IDs at link time with current IDs would falsely reject
   retries after lifecycle changes. The link snapshot is immutable history, not the current
   membership authority. Current activity remains derived from canonical Work Orders.
5. Initial proposed status eligibility used a guessed legacy label. Read the actual existing
   browser Scheduling contract: Draft, Planned, Active and Near Completion. Preserve draft
   eligibility and those original import statuses; do not invent an In Progress Project state.
6. Phase dependencies/terminal execution cannot be certified from the dormant planning record.
   Reject unreconciled dependent/imported phases until canonical completion integration exists.
   This is documented as a remaining release gate, not silently declared complete.
7. A pre-write check alone would allow concurrent requests to retag the same offer ID.
   Offer persistence now validates context ownership transactionally. Existing cached reads
   remain cached; new availability writes incur a scoped offer-document read. This cost must
   be measured rather than claimed free. Concurrent mixed-selection tests are required.

## Required results

Local Node 22.16.0: 103 dependency-free Projects tests passed, zero failed/skipped. Nine
existing Booking Authority Firestore tests also passed. Attempting the wider local Booking
suite reached 139 passes and two loader failures because firebase-admin was not installed;
that attempt is NOT recorded as a full-suite pass. Real emulator and dependency-installed
full Booking/Field/combined ERP tests are required in CI before this increment is accepted.
Their exact-head results belong in the PR verification comment.

A transaction test double is not proof of real concurrency. The emulator suite separately
covers concurrent identical/different requests and injected failure after all writes stage.
The previous WebKit route-prefetch failure remains open; changing test interception alone
has not resolved it. Do not waive the zero-page-errors assertion or weaken CORS/security.

## Decision

Keep PR #514 DRAFT and production unchanged. The server bridge can close one consistency gap
but is not whole-module completion: frontend cutover, measured Field labor and phase execution,
lifecycle/templates/cost parity, actual original-data reconciliation and backup/recovery are
still outstanding. Authorization for a whole-module merge is conditional and not yet satisfied.
