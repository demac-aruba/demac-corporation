# Projects: atomic Office booking handoff

## Approved work and safety boundary

Christian authorized continuing Projects to completion, with clean architecture and no
merge until the whole required flow and safety checks are complete. This is Deep Review
work on PR #514, not an activation, deployment or production-data migration authorization.
The separate advisory-budget correction remains PR #515.

## Decision and source ownership

The existing Office API accepts an optional project selection when checking availability.
The same Project registry rules validate the current provisioned user, customer/property,
planning version and phase. The resulting offer, not an arbitrary create payload, owns the
selected Project/phase/actor context. An availability request ID cannot change its selection.
Offer persistence uses an atomic ownership check as well, preventing concurrent ordinary/
Project requests from retagging the same offer. This adds an offer-document transaction read
on uncached availability checks; its live latency is not yet measured. No Project fields are added
to the shared canonical work-line normalization contract.

Booking Authority revalidates Project context inside its existing Firestore transaction.
Prepared Project relation/audit writes commit atomically with the Appointment, every primary
and support Work Order, capacity locks and the existing booking retry receipt. There is no
post-commit browser-only link, trigger race, new queue, independent booking writer or second
capacity decision. All reads occur before any write. An invalid Project does not leave a
partial booking, and a failed booking does not leave an independent Project allocation.

The relation uses the same projectAppointmentLinks identity consumed by registry activity
and reviewed historical reconciliation. It records every Work Order ID from the confirmed
booking and a historical estimate snapshot. It does NOT increment an actual-hours counter,
raise the estimate, change physical completion, create stock movements, or send notifications.
It does not repeatedly rewrite one whole Project document as a global booking counter.

Ordinary non-Project bookings incur no new registry/profile/settings reads in Booking
Authority. Existing live Project selection still uses the old browser path until the
frontend cutover is separately completed and verified. Do not claim that path is replaced.

## Contracts and failure behavior

- Constructor/build activation defaults off; projects-registry.backendEnabled AND
  projects-registry.bookingEnabled must both be explicitly true for new central bookings.
- Current provisioned Project write permission is required. No IAM, role or rules widening.
- Original offer context is actor-bound; current Project version and CRM identity are checked
  again at commit. Unknown/malformed input is rejected rather than truncated into a new ID.
- Budget exhaustion is NEVER a booking rejection. Actual Van/time conflicts remain enforced
  exclusively by the existing scheduling provider/Booking Authority locks.
- Existing eligible Draft/open planning is preserved; closed/on-hold Project status is not
  silently reopened. Imported closed states remain restricted pending reconciliation.
- Canonical phase-completion authority is still pending. Dependent phases and imported phase
  execution are explicitly blocked pending reconciliation, not satisfied by preview reports.
  This restriction is an unresolved rollout gate, not claimed phase lifecycle parity.
- All booking receipt replay paths perform current Project access/link checks. Deactivating
  new central bookings, or later updating a Project version/status, does not prevent a safe
  read-only retry of an already completed booking. It must never create a replacement.
- WorkOrder IDs at booking remain a historical snapshot. Later lifecycle changes do not
  rewrite it or cause an exact retry to equate past and current WorkOrder membership.

## Verification requirements

Dependency-free tests exercise the actual Booking Authority with a strict transactional
in-memory double. The real-emulator suite calls the existing authenticated Office HTTP
handler with actual Auth tokens and Firestore, using deterministic scheduling inputs.
Existing provider/Booking/Field regression suites remain mandatory to cover live-rule parity.
No tests are removed, bypassed or weakened. CI records the exact tested head and outcomes.

Scenarios: ordinary unaffected booking, full multi-Van association, over-estimate allocation,
exact/concurrent retries, competing real locks, stale version, current permissions, runtime
switch changes, foreign WorkOrder identity, injected failure after staged writes, temporary
hold confirmation/cancellation and preserved original plan. No production fixtures are used.

## Recovery and unresolved gates

No real browser backup, cloud backup, restore or historical reconciliation has been performed
by this work. The constructor/runtime gates remain off in normal builds. Before activation:
complete central picker and source migration, canonical phase/labor/cost/template parity,
WebKit failure investigation, full combined regression, actual backup/restore rehearsal,
reviewed rollout and rollback/forward recovery. Existing appointments have no projectContext
added or rewritten by this development. Rolling back code does not restore erased data and
must never overwrite newer appointments with a stale full backup.
