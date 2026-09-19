# Projects recovery runbook — implementation contract, not executed production evidence

## Required before activation

Record the approved release SHA, previous deployed artifact, explicit owner activation
approval, verified original-browser Project/template backups (all actual operator profiles),
Cloud backup operation identity/time/completion, Firestore database/region/project identity,
retention, and an isolated restoration check. Compare record counts, canonical IDs, Project
links and source evidence. Reconcile collisions and missing records before import. Tooling,
a checksum alone, a green emulator, or this document does not certify a production backup.

A source snapshot predates subsequent office work. Never restore an old whole database over
new customer/appointment activity as the default recovery action. Preserve the incident state
and the post-backup audit window before any separately approved data recovery.

## Stop further Project writes without losing visibility

A designated operator with production configuration authorization may set the established
`businessSettings/projects-registry.writesPaused` to true. This is NOT executed by this PR.
The new registry rejects new mutations and the existing Project Booking adapter rejects new
Project reservations. Ordinary bookings remain owned by Booking Authority and are not routed
through this setting. Keep backendEnabled enabled so shared Project reads remain available.

Exact authenticated replay of a mutation or booking that already committed remains available,
including while paused. A result with uncertain delivery must be recovered with the SAME
request identity and payload; do not create a replacement customer, Project or appointment.
Changes in provisioned user authorization are still enforced during recovery.

## Code rollback versus data recovery

Before shared-data activation, the default-off feature can be reverted to the prior code with
no import. After activation, do NOT silently switch shared Projects back to old browser copies:
operators could create divergent planning records. First pause new Project writes, preserve
central read/recovery access and verify that a rollback artifact understands existing canonical
links and supported Project statuses. A compatibility release or forward repair may be safer
than running pre-migration code against new records.

No migration deletes browser originals. Imports use stable IDs, exact source provenance,
collision rejection, transactional audit and receipts; the stored original source is immutable
recovery evidence, not a command to overwrite current execution. Identify exact affected records,
compare preconditions and issue a reviewed selective correction. A destructive restore requires
separate approval and an isolated rehearsal. Do not promise instant data restoration; measure
actual restore time and capture the loss/recovery window.

## Re-enable only after verification

Verify affected Project identities, latest sources, idempotent receipts, primary/support booking
links, capacity locks, ordinary Scheduling, Field reports and communications. Recheck user roles
on a second device, and verify the affected release's performance measurements. Then an
explicitly authorized operator may clear writesPaused. Keep all incident/restoration evidence.

## Current evidence status

This runbook and pause handling are code under test. No original client-browser backup, Cloud
export, production restore, write pause or migration has been executed in this development.
