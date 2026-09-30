# Technician App integration continuation — 30 September 2026

Source: PR 526 continuity comment 5836339893 and owner's request to complete the
remaining integration, validate it, and leave it ready for approval. Public preview
is not a prerequisite. PR merge, auto-merge, deployment and production activation
remain prohibited without owner approval.

Starting head was 69c2f8726b47b93573f960805b10d597feea0665. Main
3bf50a781cd4e12095ecb7d036934390aaef2fa7 was incorporated only into the task branch.
Both content conflicts were resolved: backend scripts retain the union of all
tests/checks; Scheduling uses main's server-backed project fixture with the open
weekday clock retained. Main itself was not changed.

## Implemented integration

- Existing technician/controller/Field Authority flow remains the application.
  Part-selector exit refreshes canonical versions; leaving procedures refreshes
  the parent intervention before an add-on or closure action.
- Editors are scoped to part/step; pending text and binary storage remain scoped
  to original user/visit/intervention/asset. Late command/sync responses cannot
  restore a workspace invalidated during the request.
- Confirmed photos, audio and video open through the existing authenticated,
  hash-checked private read adapter. Device-local URLs are revoked on close,
  unmount, backgrounding and session invalidation. No public URL is generated.
- Indoor temperature measurements expose the instrument-photo control required
  by the existing protocol. Supplemental audio/video display confirmed and local
  receipts. Uploaded audio is labelled attachment, not falsely labelled recorder.
- Office exception selection is keyed to account/context and ignores superseded
  loads. Office final review now shows frozen 14/9 procedure results, measurement,
  authors, exceptions and private media. Server projections derive read-only
  procedure documents solely from the immutable revision, never current workflow.
  The client validates exact revision/intervention identity and frozen workflow.
  Existing stored revisions are not rewritten; revisions without a protocol remain
  compatible. Viewing creates no revision write.
- Assigned writable helpers use the existing sale.propose capability to record
  canonical catalog add-ons, customer decisions and installed/delivered/sold state.
  They receive no global execute, intervention.complete, visit.complete,
  office.review or price.override. Read-only, unassigned and revoked access remain
  denied by the same transaction-scoped assignment boundary. Noncatalog drafts
  remain unpriced and require Office review. Catalog sale does not invoice or move
  stock. Recording installation is blocked while the affected equipment has an
  open protocol risk; customer approval does not clear the risk.

## Validation and separate adversarial review

Mode: Deep Review; Solo Maintainer Adversarial Review, not independent review.
The review pass inspects the complete incremental diff and direct consumers,
including assignment/role projection, sale contracts, frozen revision projection,
private-media provenance, editor lifetime and command-response invalidation.

Required old navigation/concurrency/security/offline/backend assertions remain.
The old no-media/no-business-effect navigation scenario is separate from the new
visible capture scenario. The one helper sale-denial assertion for writable
assigned helpers changes to the explicitly scoped capability; read-only denial
and global closure/Office/price denial remain, with new positive and risk tests.

New mandatory Chromium/WebKit scenario uses two visible synthetic participant
devices and a separate Office device. It exercises all 14 indoor/9 outdoor
controls, distinct original PNG capture/upload, private PNG decoding, measured
indoor instrument evidence, per-step text, Office queue exception disposition,
isolation, both part completions, final functional failure and Office's frozen
procedure/media view. Actual backend commands submit the result; the existing
Auth/Firestore/Storage emulator suite separately verifies submission/return/
resubmission/approval and immutable revisions. None of these tests use production.

Local checks and exact-head remote outcomes are recorded in PR comments. A remote
failure remains a failure until a corrected head passes. No browser pass is
claimed from this container: browser downloads were rejected by its network.

## Activation and rollback

Owner approval is still required for merge/deploy, including the scoped helper
sale capability. Deploy compatible Field backend readers/guards before the new
frontend and before opting Standard Service catalog items into protocol v1.
Catalog opt-in is a separately governed production change; no item was activated.
Other services retain the existing report flow and do not inherit a made-up 14/9
protocol. No Firebase rules, IAM, secrets, billing or production records changed.

Before protocol activation, source rollback is sufficient. Once a protocol has
been used, retain frozen protocol/media readers and closure guards; do not delete
active records, evidence or previous revisions during rollback. Disable further
catalog opt-ins instead of stranding work already in progress.

Physical-phone camera/microphone/container compatibility and business/visual
acceptance are owner live-review work, not a claim made by browser emulation.
The per-procedure optional audio/video control accepts device recordings/files;
it does not add a separate in-app microphone recorder. Automated orphan-media
cleanup is not part of this integration and originals are never silently deleted.
