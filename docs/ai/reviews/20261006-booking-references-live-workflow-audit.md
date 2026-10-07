# Booking references: live-workflow audit, 6 October 2026

## Scope and authorization

Christian requested a fresh audit before release, specifically protecting real customers,
appointments, existing scheduling workflows and performance. Merge/deploy is authorized
only when the audit/release gates pass. This is a separate Solo Maintainer Adversarial
Review, not an independent review.

Baseline: main `36392f4aabbda65f839008a54edfba799a39329f`. Implementation reviewed:
PR #557, including `e9fa0916`, corrective `da406a2a` and concurrency verification
`55e8ab22`; follow-up recovery checks are included in this audit commit.

## Findings and resolution

| Risk | Finding | Correction / evidence |
| --- | --- | --- |
| High | A terminal file failure kept a permanent recipient lock, stopping later jobs and subsequent days | Release terminal locks; preserve failure/cursor; allow dependencies to advance after terminal failure. Regression covers same-day work, next-day work and exact ACK replay |
| High | One malformed bundle could throw out of the poll and stop all Vans | Quarantine only the malformed command and continue; empty bundle and invalid path tests pass |
| Medium | Locks referencing terminal/deleted commands could strand a recipient | Read owner transactionally; recover only when owner is no longer queued/processing; never steal an active delivery |
| Medium | Manual file retry could revive the old crew's snapshot after a move/cancellation | Recheck current Work Order, Appointment, date, canonical Van, reference version and active wacli transport before retry |
| Medium | New 25 MB buffered media handlers inherited high default concurrency | Bound the new handlers to four concurrent requests per 512 MiB instance; files remain uploaded/downloaded individually |

## Existing workflows and data boundaries

- No migration, production-data deletion, security-rule change, customer/Property edit,
  commercial/pricing edit, capacity-policy change, payroll change or bridge restart.
- Later reference edits patch only `appointments.visitReferences` plus their private
  upload manifests and append-only reference audit. They do not replace the Appointment.
- Original offer/lock transactions still own creation, hold, Project, support, reschedule,
  cancellation, rest-day overtime, capacity overtime, emergency and historical behavior.
- Legacy appointments require no reference field. No new upload/profile reads occur in
  the reference commit preparation when the optional input is absent.
- Reference-only changes do not write Work Orders or trigger customer confirmations.
  Historical/future/held reference edits stay silent. Current assigned primary/support
  Vans receive same-day eligible updates. Removed files remain retained for queued snapshots.
- Scheduling sends remain at 08:00 Aruba, with existing 08:05/08:10 idempotent recovery.

## Verification evidence

- Local Booking Authority: 235 tests passed; transactional WhatsApp: 119 passed;
  gateway/media/office consumers: 76 passed. No required tests were disabled/skipped.
- Firebase syntax and ERP typecheck/build passed. No UI source change in this audit.
- GitHub run `37533353244`: real Firestore emulator concurrency tests and desktop/mobile
  reference editor/reader passed using synthetic data only. Tests demonstrate one winner
  for competing edits/file ownership, preservation of full existing scheduling fields,
  untouched Work Order/capacity locks, and concurrent schedule edit surviving reference save.
- Read-only runtime audit `37533003849` and `37533353244`: deployed Office Booking
  Authority (66 dependencies), poll/ACK (1 each), confirmation producer (15), daily
  schedule producer (9) match the main baseline. All five functions ACTIVE. Existing
  scheduler is ENABLED, `0,5,10 8 * * *`, `America/Aruba`.
- Running bridge SHA-256 matches reviewed `ops/digitalocean/deploy/server-v2.mjs`:
  `19d4f2b53aa942981f8c0bba8ba8f96ef10bc136833496038edc8e0ebe95d1f7`.
  Native media/voice, durable ACK storage and ffmpeg verified; health OK, no outbound
  error, zero pending ACKs at inspection. No test message was sent to an operational group.
- Local browser rerun was unavailable because this workspace lacks a Chromium binary;
  the successful GitHub browser run supplies that gate, not a claim of local success.

## Release decision

### Final release outcome, 7 October

The pending states recorded below are historical. PR #557 merged as `f295b309`;
bounded backend run `37660955346` succeeded, and production ERP deployment
`dpl_FVYdCZGEhEk9hg2CeQPnk6dCcsLF` is READY and serves the normal live aliases.
The [release record](20261007-booking-references-release.md) contains final evidence,
deployment-tool corrections, preserved scheduler/runtime checks and scope limits.

### Owner-authorized real media smoke, 7 October

Christian explicitly selected his personal Aruba number ending 6772 for synthetic
photo/video/audio tests. This supersedes the draft ADR's proposed test-group destination.
GitHub run `37655187654`, commit `ab8c8df41e684df3107fb1d97a5514a3d40f0ac1`,
first rechecked deployed source against baseline and then sent six parts through the
existing queue, production poll/ACK and running bridge: introductory test text,
two labeled synthetic images, a four-second synthetic video, voice explanation,
and a native voice message converted from a synthetic Spanish MP3.
All six were acknowledged `sent`, each with a provider message ID and one attempt,
between 16:51:41 and 16:52:17 UTC. No operational group received a test.
No Appointment, Work Order, client, Property, capacity record or Van mapping was
created, read or changed by the smoke sender. Only synthetic private fixture objects,
six deterministic queue records and the normal transport message/audit records were
created. Fixture URLs expire after one hour; no credentials or URLs are in artifacts.

This proves candidate message formatting and actual native media transport. It does
not claim a production office upload or bundle endpoint test: those endpoints have
not been deployed. Bundle concurrency, media authorization and reference editing
were validated separately with synthetic/emulated data. Provider acceptance is not
proof that the recipient viewed every attachment.

All 22 Actions runs and the ERP Vercel preview for implementation head `0f7155ef`
succeeded. The bounded release is prepared in
`scripts/booking-references-approved-deploy.cjs` and
`.github/workflows/booking-references-approved-release.yml`. Three preflight rejection
tests prove that unreviewed main, a different recipient, or an unacknowledged smoke
cannot reach any cloud operation. Existing runtime configuration and daily scheduler
are compared before/after; only the nine listed functions may be deployed. New
upload/save API comes last, after media transport and existing producers/authorities.

GitHub returned internal errors when updating PR metadata and twice when marking
PR #557 ready on 7 October (16:58–16:59 UTC). As of this evidence update the PR is
still draft, unmerged, and no backend/frontend deployment has occurred. The
release workflow cannot run unless current main contains the reviewed application.

### Original 6 October decision (superseded by the smoke evidence above)

Code/data-compatibility audit passes after the corrections, subject to final CI on
the exact head. A real ordered photo/video/voice delivery to an explicitly selected
test group remains the release smoke required by the ADR. Synthetic tests and bridge
source/health inspection do not prove provider delivery. Do not publish the new UI
as fully validated until that smoke is completed. No production merge/deploy occurred
during this audit.

Release must use `[merge-only]` and deploy the new private endpoints, updated
poll/ACK, reference update/cleanup workers and producers, and Office Booking Authority
before ERP hosting. No legacy queue migrations or Van-group realignment scripts are
needed or authorized for this feature release. Before each deployment compare the
live source/revision again; stop if another deployment changed it.

Residual limits: provider-send/ACK crash retains at-least-once delivery; many large files
take longer after 08:00; linked-file retention is conservative; poll cost grows with
blocked backlog. Never promise zero failures or exactly-once external delivery.
