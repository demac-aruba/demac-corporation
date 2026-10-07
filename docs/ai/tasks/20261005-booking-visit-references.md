# Task: Booking references delivered with each WhatsApp work order

## Context and scope
Christian approved the booking mockup on 5 October 2026 and explicitly requires
photos with explanations, videos, voice notes and GPS in the existing individual
WhatsApp work messages sent at 08:00 Aruba time. Operators must also edit references
after booking. Covers ordinary, Project, historical, hold and overtime bookings.

## Governance
Deep Review: private uploads, additive appointment metadata, ordered transport and
retry behavior. Booking Authority owns `appointments.visitReferences`; private
`bookingReferenceUploads` records are staging/retention manifests, never another
appointment or Work Order. Existing communication authority/queue/provider remain
authoritative. No financial, capacity, technician evidence, or customer notification
change. No production migration or security-rule change.

## Acceptance criteria
- References are optional, ordered and editable, with a description per file.
- Creation commits references and upload claims in the booking transaction.
- Current office roles may edit; assigned technicians/helpers may read today's work.
- Private media is authenticated; the existing WhatsApp bridge receives opaque, claim-bound
  retrieval URLs valid only during the active dispatch lease, with no permanent download token.
- Each work message precedes its own files and explanations; next work waits during delivery/retry.
  A terminal file failure remains visible/retryable and releases later work, never blocking a Van indefinitely.
- Acknowledged segments survive retries; conflicting edits and upload reuse fail closed.
- Updates after 08:00 notify the current assigned Van; historical writes remain silent.
- Existing bookings with no references retain their behavior.

## Verification and recovery
Focused authority/upload/sequence tests, booking and WhatsApp consumer tests, ERP
typecheck/build, and a separate Solo Maintainer Adversarial Review. Automated domain
tests stay isolated; the separate owner-authorized transport smoke uses only the
owner's personal number and synthetic media. Additive fields permit rollback;
staged unclaimed uploads expire and are removed by a bounded cleanup job.

## Authorities, risks and delivery
- Rule: `OPS-SCHED-REFERENCES-001`; existing `FIELD-DAY-001`, historical-silence,
  Booking Authority and single WhatsApp authority constraints apply.
- Canonical 08:00 cron and 08:05/08:10 deterministic recovery windows are unchanged.
- Private types are limited to supported photos/video/audio, 20 files and 25 MB/file.
- Three failed attempts stop a bundle at its current segment, preserving the failed
  record and cursor while releasing later work. The office retry action resumes current,
  eligible failed deliveries without resetting confirmed segments; stale/cancelled/moved
  jobs and superseded reference versions are not revived.
- On 2026-10-06 Christian authorized merge/deploy conditional on an additional audit
  protecting existing live data and workflows. On 7 October he selected his own
  number for synthetic media tests; all six parts were acknowledged on their first
  attempt. PR #557 merged and the bounded backend and ERP production releases
  completed. See the [release record](../reviews/20261007-booking-references-release.md).
- Architecture and separate review: [decision](../decisions/ADR-20261005-booking-visit-references.md)
  and [review](../reviews/20261005-booking-visit-references.md).
