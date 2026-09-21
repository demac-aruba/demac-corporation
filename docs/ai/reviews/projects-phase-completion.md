# Project phase scope acceptance — implementation and adversarial review

## Task, authorization and delivery boundary

The owner requested continuing Projects to a safe, finished module. This increment completes
explicit phase acceptance/reopening and its prerequisite check. Deep Review applies. Target
branch: feature/projects-canonical-integration; base 4fe535a. No main merge, production
activation, migration, operational-data changes or security-rule changes are authorized by
this increment. Existing default-off activation remains intact.

## Authority and business rule

Field Operations owns visits, reports and Office Review. Booking Authority owns capacity and
Appointment/Work Order commits. The existing Project registry owns acceptance of a defined
project phase. A manager's explicit scope acceptance is NOT a replacement Field report, a
payroll entry, an automatic material transaction or an invented percentage of time worked.

`approve_phase_completion` requires a current preview, verified canonical Field/Office
sources, the current project version, explicit scope confirmation, all planned units for a
unit-based phase, required checklist items and a review note. Hour-based phase display is
not evidence of physical completion: the same explicit scope acceptance remains required.
All active primary/support orders must have approved Office Review and a completed current
visit; Field's existing linear-chain resolver detects newer return visits or broken history.
The estimated budget is never a completion criterion or a hard cap on booking more work.

Completion markers are additive `projectRecords.phaseReviews` metadata. Their full evidence
is recorded on the EXISTING immutable `projectEvents` audit entry, using exact Firestore
source update versions, not copies of private reports. No new collection or independently
writable execution system is introduced. Existing registry authorization, expectedVersion,
receipt and audit transactions are reused. No additional public endpoint is exported.

`reopen_phase` preserves prior approvals in audit. New work on a closed phase requires this
explicit reopening. Existing bookings are not cancelled or rescheduled. New phase bookings
require valid, current prerequisite approvals. Old idempotent booking replays remain readable
without reopening the phase or creating another appointment. General Project Work and ordinary
bookings do not acquire any phase-evidence reads.

## Source freshness and bounded queries

Phase review reuses the existing canonical activity projection with an INTERNAL phase filter
and optional version observer. Normal activity response fields and whole-project forecast
semantics are preserved. Approval previews have a cap of five 10-appointment pages and 400
source records; incomplete data blocks approval, never produces a fake completion.

Subsequent prerequisite checks read only referenced documents and verify exact seconds plus
nanoseconds of their database versions, plus current phase-link membership. They do NOT scan
Field event history. Transaction-local caching shares proof reads across dependencies and
never survives a retry or account boundary. Changing a report, review, source link or phase
scope invalidates the approval for dependent work until it is reviewed again. Administrative
updates to unrelated fields on a referenced document can conservatively require renewed
review; this is disclosed as a residual availability tradeoff, not silently bypassed.

No deployment claims for Firestore indexes are made from emulator results. Before activation,
the phase-scoped query and deployment indexes must be verified against the staging database.

## UI and failure behavior

The existing Plan & phases screen opens an accessible review dialog using existing modal,
typography, styles and transport. It loads on demand, shows approved source identities and
blockers, and preserves the shared pending-request journal on ambiguous saves. A late read
for a dismissed/changed project is ignored. Finance may inspect but not approve. The client
cannot submit independent units/progress values to Field.

This increment does not fabricate a portfolio physical percentage or turn all scheduled
hours into actual labor. Intermediate physical quantities and project-wide lifecycle/cost
reconciliation are still separate whole-module gates.

## Separate adversarial self-review

Reviewer: implementation author under Solo Maintainer Adversarial Review; NOT independent.
The second pass covered the complete diff and Booking, registry and Field consumers.

Findings corrected before publication:
1. A completed earlier visit could hide a newer return visit. Reused the existing Field
   chain-tip resolver and matched the approved Office Review to that exact tip.
2. A stored acceptance event needed its explicit confirmation revalidated, not only its
   proof signature. Read validation now rejects malformed units/checklist confirmations.
3. Reopening and phase deletion could otherwise discard scope history. Events remain
   append-only and phase deletion with approval history is rejected.
4. One fixture used an illegal await in a default parameter. Syntax check caught it before
   publication; it now resolves the default inside the async test helper.

Acceptance: unit contracts, emulator approval/replay/concurrency/source-change/rollback,
existing Booking regressions and both browser engines, with negative permissions and mobile
controls. Exact published-head CI results will be recorded in the PR checkpoint; no unrun
emulator/browser result is prefilled here. Local source is a partial verified archive,
not a production checkout; modified pre-existing blobs were checked against the branch.

Release decision: KEEP DRAFT until applicable CI and whole-module gates are complete.
Still outstanding: actual original-browser/cloud backups and restoration exercise; historical
reconciliation; person-time corrections and intermediate physical progress; full templates,
project lifecycle/materials/cost parity; remaining combined lifecycle/rollback acceptance;
and reviewed production exports/configuration/activation. No production record was read,
backed up, imported, restored or changed by this implementation.
