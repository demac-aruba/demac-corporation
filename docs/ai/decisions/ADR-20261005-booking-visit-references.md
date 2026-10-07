# ADR-20261005: Booking-owned references and ordered WhatsApp work delivery

- Status: Accepted design; corrected backend and actual ERP domains released on 2026-10-07; see [corrective audit and release evidence](../reviews/20261007-booking-references-production-reaudit.md)
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
failure preserves the failed bundle but releases its recipient reservation and later
schedule dependencies. An invalid command is quarantined without failing the poll
for healthy jobs; reservations of terminal/missing queue records are recoverable.
The existing office schedule communication authority can retry failed schedule messages
and files, honoring enabled outbound settings, active transport, current Van/group,
Work Order/date/status and reference version, without resetting sent segments.
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
- A bad file stops its bundle after three failed attempts; later jobs and other groups
  can proceed. Office recovery is explicit. Many large files increase
  delivery duration after the batch begins at 08:00.
- Per-claim tokens reduce exposure but do not provide recipient revocation after a file
  has been delivered through WhatsApp.
- Existing bridge ACK persistence reduces duplicates, but a crash after provider send
  and before durable ACK can still duplicate a segment. Do not promise exactly-once delivery.
- Poll scanning is linear in blocked backlog. Monitor queue age/read load if backlog grows;
  deployment does not introduce a new index or a competing scheduler.
- New media upload/read endpoints limit instance concurrency to four with 512 MiB;
  they never load all files in a booking into one request. Existing transport endpoints'
  memory/concurrency settings are preserved.

## Verification and rollout

Evidence is recorded in the linked task and review. Automated domain tests use
synthetic accounts and records. The separately owner-authorized live transport
smoke below sent only synthetic media to the owner's selected personal number.

After human release approval, deploy the new reference HTTP/cleanup/update functions,
Booking Authority facade, daily/change producers and modified gateway/media endpoint
from one reviewed revision, then ERP hosting. Existing bridge source needs no feature
change, but confirm the deployed bridge supports media/voice before the release smoke.
Use an owner-selected test destination for the first real ordered-media delivery.
On 7 October Christian authorized his own Aruba number ending 6772; run
`37655187654` delivered the six synthetic text/photo/video/voice parts with one
acknowledged attempt each through the existing production transport. New bundle
state/concurrency and private media guards remain separately covered by isolated
tests. The [7 October release record](../reviews/20261007-booking-references-release.md)
records the first bounded backend release and secondary UI publication only. The
[corrective audit](../reviews/20261007-booking-references-production-reaudit.md) records
PR #559, the two-function correction and verified publication on both actual ERP domains.
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
