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
- Each work message precedes its own files and explanations; next work waits for completion.
- Acknowledged segments survive retries; conflicting edits and upload reuse fail closed.
- Updates after 08:00 notify the current assigned Van; historical writes remain silent.
- Existing bookings with no references retain their behavior.

## Verification and recovery
Focused authority/upload/sequence tests, booking and WhatsApp consumer tests, ERP
typecheck/build, and a separate Solo Maintainer Adversarial Review. Production
WhatsApp messages are not sent during tests. Additive fields permit rollback;
staged unclaimed uploads expire and are removed by a bounded cleanup job.

## Authorities, risks and delivery
- Rule: `OPS-SCHED-REFERENCES-001`; existing `FIELD-DAY-001`, historical-silence,
  Booking Authority and single WhatsApp authority constraints apply.
- Canonical 08:00 cron and 08:05/08:10 deterministic recovery windows are unchanged.
- Private types are limited to supported photos/video/audio, 20 files and 25 MB/file.
- Three failed attempts stop a bundle at its current segment and block later jobs
  for that recipient. The office retry action resumes failed schedule deliveries
  without resetting confirmed segments; other Van groups remain available.
- Approval scope is implementation. Merge/production deployment remain pending.
- Architecture and separate review: [decision](../decisions/ADR-20261005-booking-visit-references.md)
  and [review](../reviews/20261005-booking-visit-references.md).
