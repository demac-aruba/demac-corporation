# Projects: on-demand Field execution evidence

## Approved scope and engineering mode

Continue PR #514 on feature/projects-canonical-integration; no merge, production activation,
migration or data writes. Deep Review. This increment advances Field -> Projects without
creating another Field timer, payroll ledger, appointment writer or mutable actuals counter.

## Source evidence and interpretation

`fieldOperationsVisitMutation.js` commits status changes and `fieldOperationEvents` atomically.
`fieldOperationsOfficeReview.js` sets WorkVisit completedAt at OFFICE APPROVAL, not when
physical work stopped. Returning a report also changes visit status to in_progress without
a new physical start. Therefore startedAt -> completedAt subtraction and treating an office
return as a restarted technician timer would fabricate work. Both are explicitly rejected.

Existing Field status intervals are useful reported evidence, not certified person-hours.
The read projection measures only CLOSED in_progress intervals, stops at pending, physical
return, report submission or cancellation, excludes travel/office waiting, and does not
extend an open interval to the browser clock. Missing, contradictory, truncated or
correction-ambiguous timelines remain null. No physical-completion percentage is derived
from time spent. Correcting incomplete historical time remains a separate governed workflow.

## Implementation

- Pure deterministic field-execution projector reuses the existing transition authority;
  validates identity, version and event times; deduplicates exact deliveries and refuses
  conflicting events or future unknown WorkVisit transitions.
- get_execution is a READ action in the existing registry service. Same current role and
  runtime authorization; consistent read-only transaction; no extra write authority.
- Activity adds previousVisitId as additive response metadata for the existing visit-chain
  validator. Existing activity totals and booking queries do not start reading event history.
- Dedicated on-demand Field execution panel in the central workspace. Pages remain bounded;
  max 2,000 event records per execution page, queried in batches of ten parent Work Orders.
  The event read is not invoked on booking-slot clicks, portfolio rows or a polling timer.
- Multiple Vans/physical return visits are retained; overlapping intervals for one Van block
  aggregate comparison; cancellation does not erase recorded execution. Page subtotals are
  not full-project totals. No permanent projection collection or migration is introduced.

## Acceptance / verification

19 focused projector tests and all 122 current local Projects unit tests pass on Node 22.16.0.
Added eight Auth/Firestore emulator cases to the existing mandatory registry workflow:
measured multi-Van reads, cross-user authorization, overlap detection, physical returns,
cancellation, foreign identity, truncation and activation. Twelve collections are compared
before/after the read. Final exact-head CI and browser results must be recorded in the PR;
this initial task is NOT a claim that those tests already ran.

## Remaining release gates

This is recorded visit-active time, not an approved person-time or labor-cost implementation.
Missing history/correction handling, physical phase completion and template/lifecycle/cost
parity still need completion. Existing intermittent WebKit diagnostic remains under review:
the last low-overhead lifecycle run passed but did not reproduce it; no test classification
is waived. Original-browser/cloud backups, restoration rehearsal, real reconciliation and
reviewed deployment/activation still block whole-module release. No production data is used.
