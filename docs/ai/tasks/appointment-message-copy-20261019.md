# Task: Clear booked addresses and friendly appointment closing

## Context and scope
Christian approved the displayed English confirmation format, then explicitly approved publishing, merging and deploying it on 2026-10-19. The existing messages mix the street address, generic property label, dwelling name and redundant code. Confirmation, reminder and technician messages must show the booked destination clearly. The English closing should invite questions and offer help.

Application code uses Fast Product Validation. The controlled release receives Deep Review because it patches five production function sources. The ordinary deployment paths can publish unrelated source/configuration, so the existing source-only transport, private recovery, operation-provenance and configuration verification utilities are reused.

## Authority and acceptance
- Booking Authority owns saved Appointment/Work Order locations. Message formatting reads the existing snapshot; it never infers a unit from the current property catalog.
- Communication Authority retains recipients, queue IDs, eligibility, providers and retry behavior. No queue edits, backlog replay, production customer reads, new send, migration, role, IAM or policy changes.
- Client wacli text gets separate address lines. Named units omit redundant codes; missing names retain the code. Generic numbered apartment labels follow the recipient language; custom names remain unchanged.
- Existing Meta template shape remains five single-line parameters. Its externally approved fixed copy is outside this wacli-format release.
- Legacy jobs without a saved unit keep their address. Linked Appointment fallback remains identity-checked for support work.
- Technician daily, same-day, support and reference-update paths use the same saved destination.

## Release and recovery
Only officeBookingAuthority, queueAppointmentConfirmation, sendDailyAppointmentReminders, sendDailyTechnicianSchedules and notifyBookingReferenceUpdate may be patched. Only six message modules may differ in each live source bundle. The approved application files are pinned to commit 86eb8679e7ef87e3be0d7d797c02549044645e7e. The release branch must equal main and its checkout SHA. Merge uses [merge-only]; a separate release branch activates the guarded workflow.

Before any function mutation, all five live bundles are patched without replacing unrelated files, checked with their exact dependency locks and real bootstrap, and retained with their baselines in the existing private recovery bucket. Source-only PATCH preserves configuration, IAM, triggers and schedules. Existing operation recovery handles lost PATCH responses and polls the exact accepted operation. Post-publication checks require exact candidate bytes, successful operation provenance, ready revision/traffic, unchanged configuration/IAM/scheduler, and Office CORS/authentication denial.

A partial failure stops. Retained baseline/candidate ZIPs and operation identities permit investigated forward recovery or an authorized source rollback. Blind workflow reruns are intentionally not supported: already-patched source fails the patch-base check and must be reconciled first. No automatic rollback, replay or queue manipulation.

## Verification
- 136 transactional message tests passed before publication.
- 19 release/transport/operation tests passed after final review; functions syntax validation passed.
- A later local rerun exposed a removed shared dependency directory, not a code regression; an isolated dependency install in this checkout restored the gate: all 136 tests passed again.
- CI and exact deployed-bundle validation are required before rollout. Live delivery is not tested by sending synthetic messages to real recipients.

Architecture decision: no new domain, authority, storage system or deployment platform. Existing audited source-publication utilities are reused; no new ADR is needed.
