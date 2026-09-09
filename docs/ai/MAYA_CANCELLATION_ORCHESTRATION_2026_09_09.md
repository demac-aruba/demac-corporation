# Task: Connect cancelled openings to sequential, governed earlier-appointment offers

## Request and authority
Christian authorized continued development, not merge or production activation. Parent: PR #495 at d0a1599830b985c66b7cb547206c504ad5336431. Work only on feature/maya-cancellation-orchestration-20260909. No production reads/data/configuration/security/secret changes, real messages, operational demo records, merge or deployment.

## Scope and acceptance
Connect a new canonical cancellation to bounded selected-phone conversation review, existing waitlist compatibility, configured candidate priority, existing offer preparation and existing WhatsApp queue. Continue with another eligible candidate after explicit decline or proven expiry. A pending offer waits; acceptance stops the opening's sequence. Current availability, full workload, routes, account, ownership and phone restrictions remain mandatory. Preparing or sending an offer never moves the original appointment.

Automation is separately default-closed. An activation cutoff and explicit ranking/scan/contact policies are required, never silently defaulted from test fixtures. Only canonical normalized selected-phone conversations are discovered. A bounded scan overflow or ambiguous source requires review, not a claim of complete coverage. This slice targets earlier appointments with verified workload; unbooked customers remain outside automated allocation until their workload/booking path is complete.

## Design
Booking Authority and Communication Authority remain the only domain writers and sender/queue authorities. Existing cancelled Appointment records may hold derived bounded orchestration metadata: generation, lease, policy fingerprint, offer history and outcome. It is not another schedule or capacity model. Existing bookingOffers remain the offer records; original WhatsApp messages remain evidence.

Firestore events and a Cloud Tasks handler are wake-up transport only. Payloads contain only a cancellation reference/generation; every operation rereads canonical data. New handlers are code for a later explicitly approved rollout, not deployed functions. No second WhatsApp queue, model, Customer Runtime or public callable is introduced.

Lease fencing and the policy/generation are checked inside every delegated transaction. Offer preparation and the corresponding bounded orchestration receipt are committed together. The existing outbound claim also rechecks the automation policy before delivering an automated offer. Retries resume the same recorded offer instead of creating another; uncertain previous send attempts stop for reconciliation.

## Required checks
- Exact cancellation vs pending hold, historical cutoff, replay/out-of-order events and elapsed opening.
- Selected phones/account, operator ownership, disabled flags, policy changes during review/preparation/enqueue/claim.
- Canonical history -> real compatibility -> sequential queue producer, with original appointment unchanged.
- Pending offer, explicit decline, expiry, acceptance, uncertain delivery and maximum offer/scan limits.
- Fenced stale workers, duplicate tasks, task enqueue failure, lost prepare result and atomic rollback.
- No required existing tests disabled, weakened or removed. Applicable Functions and transitive transport/runtime/build gates must pass.

## Review and rollout
Separate Solo Maintainer Adversarial Review required; not independent review. Record complete diff, affected callers, findings and residual risks. No change is merge-ready merely because CI is green.

Still required for full Maya: integrated main reconciliation, emulator/index/security/contention evidence, actual provider/phone/voice/model tests, broader clarification and late-ACK recovery, reminders, unbooked bookings, panel completion and Papiamento rendering. Deployment of new event/task handlers, their least-privilege invocation permissions, exact pilot settings and any production activation require separate approval.

Primary contracts consulted: https://firebase.google.com/docs/functions/task-functions ; https://firebase.google.com/docs/functions/firestore-events ; https://firebase.google.com/docs/firestore/manage-data/transactions . Firestore delivery may repeat/reorder and transaction callbacks may retry; no model or task enqueue runs inside a domain transaction.

## Verification
Implementation and adversarial review in progress. Local GitHub DNS resolution unavailable; do not claim a local clone, full local repository tests or emulator verification. Exact commit/CI evidence to be recorded after implementation.
