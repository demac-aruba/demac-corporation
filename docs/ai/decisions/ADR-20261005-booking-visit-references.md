# ADR-20261005: Booking-owned references and ordered WhatsApp work delivery

- Status: Proposed (implementation authorized; production release pending)
- Date: 2026-10-05
- Owners: Operations / Booking Authority / Communication Authority
- Related rule: `OPS-SCHED-REFERENCES-001`
- Supersedes: none

## Context

Office receives reference photos, explanations, video, voice and GPS both before and
after booking. Technicians need the actual files attached to the correct individual
work message in the existing 08:00 Aruba WhatsApp schedule, including afternoon work.
The current bridge source already supports native files, captions and voice conversion.

## Decision

`appointments.visitReferences` owns notes, normalized Maps/GPS, ordered file metadata,
version and actor. Ordinary, Project, hold and overtime creation commit reference
claims in the same Booking Authority transaction. Later edits are authenticated,
version checked, idempotent and audited in an Appointment child collection.

Active provisioned office scheduling roles stage uploads and edit. Field readers
must pass existing current-day Work Order assignment authorization. Bytes live in
private Storage `booking-references/{uid}/{fileId}`. Existing default-deny rules remain
unchanged; authenticated HTTP proxies serve previews. No permanent download token
is issued. Upload manifests are staging/retention metadata, not domain truth.
Unclaimed uploads expire after 24 hours; the hourly worker deletes up to 100 expired
orphans per invocation. Linked files remain available to immutable queued snapshots.

One work with files becomes one immutable bundle in the existing `whatsappOutboundQueue`.
Its first segment is the Work Order text, including notes/GPS. Subsequent segments are
ordered native media; voice explanations have a separate immediately preceding text.
The current cursor advances only on acknowledged success. A per-recipient dispatch
record coordinates all wacli claims; the bundle retains it until final success.
Daily timeline dependencies keep later jobs/lunch/pending messages behind earlier work.
Polling scans subsequent pages when the initial 50 records are blocked.

The bridge receives one normal text/media command at a time. Private media URLs are
opaque capabilities tied to the current queue claim and invalid after acknowledgement
or expiry. A 10-minute bundle lease covers media download, conversion, send and ACK;
ordinary message leases retain their existing three minutes. No new sender/provider,
bridge service, secret or signed-URL IAM grant is introduced.
The retrieval endpoint also requires a server-owned linked upload manifest matching
the queue's Appointment/path; a client-created queue record cannot retrieve an
unclaimed draft. MIME is read from that manifest, never trusted from queue input.

Failure keeps the cursor; up to three attempts use 30-second retry delay. Terminal
failure pauses that recipient's bundle. The existing office schedule communication
authority can retry failed schedule messages and files, honoring enabled outbound
settings and the current Van/group mapping, without resetting sent segments.
Same-day edits after 08:00 queue a version-keyed update. Holds, history and future
edits do not cause immediate reference-update messages.

## Alternatives considered

| Alternative | Benefit | Cost / reason not selected |
| --- | --- | --- |
| Portal links only | Small WhatsApp payload | Does not satisfy actual media beside each job |
| Separate queue item per file | Simple existing dispatch shape | Files and jobs can interleave; dependency/recovery fan-out |
| New media sender / notification authority | Isolated implementation | Duplicates existing communication authority |
| Public or permanent media URLs | Easy downloads | Unnecessary persistent disclosure of customer files |

## Consequences and limitations

- No capacity, commercial, customer-reminder or technician-evidence authority changes.
- Additive schema; no existing-data migration or access-rule change.
- Linked bytes are retained even after office removes a file, because an existing queue
  snapshot may still need it. A later retention policy must reconcile queue/audit needs.
- A bad file pauses the remainder for that recipient after three failed attempts;
  office recovery is explicit. Other groups can proceed. Many large files increase
  delivery duration after the batch begins at 08:00.
- Per-claim tokens reduce exposure but do not provide recipient revocation after a file
  has been delivered through WhatsApp.
- Existing bridge ACK persistence reduces duplicates, but a crash after provider send
  and before durable ACK can still duplicate a segment. Do not promise exactly-once delivery.
- Poll scanning is linear in blocked backlog. Monitor queue age/read load if backlog grows;
  deployment does not introduce a new index or a competing scheduler.

## Verification and rollout

Evidence is recorded in the linked task and review. Tests use synthetic accounts,
records and bridge calls; no production WhatsApp messages are sent.

After human release approval, deploy the new reference HTTP/cleanup/update functions,
Booking Authority facade, daily/change producers and modified gateway/media endpoint
from one reviewed revision, then ERP hosting. Existing bridge source needs no feature
change, but confirm the deployed bridge supports media/voice before the release smoke.
Use an approved test group for the first real ordered-media delivery.
The existing automatic producer deployment alone does not publish the new endpoints.
Use the repository's `[merge-only]` release convention and coordinate the approved
release of `bookingVisitReferences`, `cleanupBookingReferenceUploads`,
`notifyBookingReferenceUpdate`, `wacliBookingReferenceMedia`, `wacliOutboundPoll`,
`wacliOutboundAck`, `officeBookingAuthority`, `queueAppointmentConfirmation` and
`sendDailyTechnicianSchedules` before enabling the new ERP UI.

Observe queue status/cursor/error, gateway logs and reference-update warnings.
Rollback must first drain or explicitly reconcile pending bundles and dispatch locks;
an old text-only gateway must not consume a partially delivered bundle. Then revert
the producers/UI. Never delete linked bytes, manifests or queued snapshots as rollback.
Review again if provider changes, file limits/retention change, or backlog causes latency.
