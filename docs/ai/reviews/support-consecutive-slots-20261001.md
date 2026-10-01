# Review: selectable consecutive coworker support

## Review mode
Solo Maintainer Adversarial Review — Codex implemented and then conducted a separate
adversarial pass. This is not an independent review or production approval.

## Scope reviewed
Complete task diff against `3bf50a781cd4e12095ecb7d036934390aaef2fa7`, the two drawer
entry points, client transport, Office facade permissions, Booking Authority transaction,
capacity interval/ownership helpers, Work Order projection and lifecycle/communication
consumers. Authorities and rules: Booking Authority, OPS-SCHED-SUPPORT-001, OPS-TEAM,
OPS-ROUTE and historical acknowledgement/audit. No new collection or permission change.

## Findings resolved
- The former one-slot lock would leave later support capacity unprotected. Every selected
  slot is now read and locked in the same transaction as the linked Work Order/assignment.
- Ordinary ownership helpers can span the lunch gap. Support explicitly rejects noncontiguous
  clock anchors, consistent with the operator's consecutive-slot request.
- Replaying with a changed duration previously returned an unrelated successful result.
  Request details are checked; duplicate support with a different duration fails. The UI
  retains its request ID for identical retries after a lost response.
- An active lock owned by the same appointment is still occupied capacity. It is rejected
  unless the support request was already resolved through the earlier replay path.

No unresolved correctness or authorization findings in this scope.

## Verification
- `npm run typecheck --prefix apps/erp-next`: PASS with tracked configuration restored
  after Next's generated configuration updates.
- `npm run test:live-scheduling --prefix apps/erp-next`: PASS, including consecutive
  support limits plus existing Saturday, overtime, attribution, card and Project cases.
- `npm run build --prefix apps/erp-next`: PASS, including all existing prebuild gates
  and static page generation. An initial local build rejected dependencies symlinked
  outside the checkout; copied dependencies resolved that environment issue.
- `npm run validate:firebase --prefix functions`: PASS.
- Focused Node tests: **84 passed, zero failures/skips** across bookingAdhocSupport,
  officeBookingAuthority, bookingCapacityAvailability, officeBookingAuthorityCommunication,
  technicianScheduleChangeService and bookingAuthorityAppointmentLifecycle.
- Real React → HTTP → Office facade → Firestore emulator: **eight desktop/mobile cases
  passed**, covering single-slot limits, two/three slots, future/past dates, acknowledgement,
  cancel/reopen, primary preservation, full capacity ownership, save/reload and lost-response
  exact-payload retry. No external browser requests. Chromium 153; viewports 1500×1060 and
  390×844. Synthetic screenshots inspected. Authentication/transport host alone are stubbed.
- Real Firestore contention: two appointments competing for overlapping two-slot intervals
  produce one success and one conflict; only the winning Work Order and two locks persist.
  Concurrent identical requests produce one write and one replay with the same identity.
- Explicit unauthenticated/technician Office denial verified before the support handler.
- `git diff --check`: PASS. CI workflow retains synthetic browser evidence and reruns the
  support contracts, browser flow and contention on relevant PRs.

## Decision / release
Pass for review; merge and production deployment require owner approval. No production
data was written and no outbound messages were sent. Deploy the Office Booking Authority
backend first, then the ERP frontend: older backends know only the single-slot command.
No migration is needed. Existing multi-slot duration/lock projections are reused. The
live production rollout and owner workflow validation remain pending. Full-day support
across lunch is deliberately represented by separate contiguous AM and PM assignments.
