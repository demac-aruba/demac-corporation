# Booking references: production release evidence, 7 October 2026

> CORRECTION: this report's completed-ERP claim was incorrect. Only the secondary
> Vercel project was published; `demac-aruba.com` remains on `36392f4a`. Backend
> publication did occur. Further deployment is on hold. See the
> [corrective audit](20261007-booking-references-production-reaudit.md) for verified
> domains, additional retry defects, evidence limits and prepared fixes.

## Decision and authority

Released after the owner's conditional merge/deploy approval, requested live-data
audit and explicit authorization to send synthetic photos/video/voice to his
selected personal Aruba number ending 6772. No operational Van group was used.
This record supersedes pending release statements in the 6 October audit.

PR #557 merged as `f295b309d3222c9add2c7f54f61981defb4abb93` with `[merge-only]`.
Automatic broad deployment/migration jobs were confirmed skipped. Production was
then released in the bounded backend-first order documented below.

## Verification

| Gate | Evidence and result |
| --- | --- |
| Domain regression | 235 Booking Authority, 119 transactional WhatsApp and 76 gateway/media/office consumer tests passed; Firebase syntax and ERP typecheck/build passed. |
| Isolated integration | Real Firestore emulator concurrency and desktop/mobile reference flows passed. Final audit run `37655664232` passed. |
| Exact PR head CI | All 22 Actions runs and both Vercel previews passed for `8f5a0cb280b6e73309dac9e4a4c01af665449147`. |
| Owner-only live transport | Run `37655187654`: intro text, two synthetic photos, four-second synthetic video, voice explanation, native WhatsApp voice. All six acknowledged sent on attempt one, 16:51:41–16:52:17 UTC. |
| Bounded backend | Run `37660955346`, release source `182746a0028058ba22abbd63449d71c9edaaf167`, succeeded. All nine functions ACTIVE and deployed application source verified. |
| Runtime preservation | Existing functions retained service/trigger configuration. New functions use the existing runtime identity and expected private bucket. Upload/media endpoints use 512 MiB and concurrency four. Anonymous probes reject access (401/403 as applicable). |
| Schedule preservation | Existing scheduler ENABLED, `0,5,10 8 * * *`, `America/Aruba`; schedule, timezone, state, target, retry configuration and deadline unchanged. No manual run of the real schedule. |
| Bridge after rollout | Reviewed bridge SHA-256 unchanged; healthy, outbound-only-v1, zero pending ACKs, no outbound error, last poll age 1.823 seconds at 17:46:09 UTC. No bridge restart. |
| Production ERP | `dpl_FVYdCZGEhEk9hg2CeQPnk6dCcsLF` READY, target production, source `8f5a0cb2`. Application trees match merged `f295b309` exactly. |
| Live route | `https://demac-corporation.vercel.app/scheduling` returned HTTP 200, title `ERP \| DEMAC`, existing AuthGate and SchedulingPageShell. All three established production aliases resolve to the new deployment. |
| Vercel runtime errors | No error/fatal groups returned for this deployment in the immediate 15-minute inspection window. This does not cover Google Cloud logs. |

Backend functions: `wacliBookingReferenceMedia`, `cleanupBookingReferenceUploads`,
`notifyBookingReferenceUpdate`, `wacliOutboundAck`, `wacliOutboundPoll`,
`queueAppointmentConfirmation`, `sendDailyTechnicianSchedules`,
`officeBookingAuthority`, `bookingVisitReferences`.

The synthetic sender created only private test fixtures, six deterministic queue
records and normal transport/audit records. It did not create, read or change
Appointments, Work Orders, clients, Properties, capacity records or Van mappings.
Release scripts perform no customer/booking writes, migrations, security-rule
changes or Van realignment. Existing optional-reference compatibility remains intact.

## Deployment tooling corrections and adversarial self-review

Solo Maintainer Adversarial Review; this is not an independent review. A fresh
complete tooling diff review checked bounded selection, source and owner-smoke
preconditions, runtime identity, strict configuration comparison, safe resumption,
no message resend, no domain writes and unchanged scheduler verification.

- Firebase config now resolves the temporary source path relative to its config.
- Firebase's noninteractive retry-policy acknowledgement is limited to the single
  newly created `notifyBookingReferenceUpdate` function with reviewed `retry:true`.
  Other functions do not receive `--force`; there is no broad deployment/deletion.
- A strict comparison stopped rollout when Eventarc returned equivalent filters
  in a different array order. Read-only diagnostic run `37660587093` established
  that the confirmation function's Cloud Run revision specs matched excluding
  image, and the existing Eventarc trigger had not been updated. Only filter order
  is normalized; fields, operators, values, policy and identities remain strict.
- Six focused guard tests passed: three block all cloud operations for unreviewed
  main, wrong smoke recipient or unacknowledged smoke; three validate harmless
  filter reorder while rejecting genuine trigger/runtime/environment changes.
- Sanitized CLI error reporting and a read-only post-rollout bridge health check
  make stops diagnosable without emitting credentials or customer data.

The first bounded runs stopped on deployment-tool preconditions; final run resumed
after fixes and verified all nine functions. No required gate was waived. The main
Vercel build was canceled by the existing `[merge-only]` convention; the production
build used the approved pre-squash PR head with identical application trees and ran
the normal build. Existing production aliases were verified after publication.

## Scope limits and recovery

The owner smoke proves formatting and actual provider transport; it does not
claim a production booking CRUD test or recipient viewing. Upload, edit, private
media authorization and bundle concurrency are covered by isolated tests. The next
real 08:00 batch was not manually triggered or observed during this release.
Google Cloud Logging reads were denied to the deployment identity; no access was
expanded and no claim of a clean Google Cloud log scan is made.

External send followed by a crash before durable ACK remains at-least-once.
Large media adds delivery time; linked-file retention is conservative and blocked
backlog scanning remains linear, as documented in the accepted ADR.

Previous UI deployment `dpl_CJPXuot93aV1ZQ4x5UhdBKHb9yAY` is retained. Before any
backend rollback, drain or explicitly reconcile pending bundles/dispatch locks;
never feed a partial bundle to an old text-only gateway. Revert producers/UI only
with that compatibility check, and never delete customer records, linked files,
manifests or queue snapshots as rollback.


## Subsequent correction

PR #559 later corrected the stale-retry defects and completed publication on the actual
business domains after renewed owner authorization and all required checks. The first
release's wrong-domain completion claim remains corrected above. See
[the corrective audit and executed release](20261007-booking-references-production-reaudit.md)
for exact CI, function revisions, actual ERP deployment and verification limits.
