# Booking references: corrective production audit

## Decision

**Initial audit hold (superseded by the conditional authorization below).** The owner reported that the URL previously
presented was not the operating ERP and that Scheduling showed no change.
The prior claim of a completed end-to-end production release was incorrect.
At that point this audit and its proposed code fixes did not authorize another production change.

Deep Review / Solo Maintainer Adversarial Review, not independent review.
Scope: all application changes from live baseline `36392f4a` to PR #557 / merged
`f295b309`, actual domain routing, shared backend, existing Scheduling callers,
ordered WhatsApp transport, retries, access, persistence and release evidence.

## Verified deployment map

Vercel account `team_DMKv1yhhUjnR4Pu141k3iwuX`; repository
`demac-aruba/demac-corporation`.

| Surface | Project | Observed deployment/source | Result |
| --- | --- | --- | --- |
| Actual business ERP: `demac-aruba.com`, `www.demac-aruba.com`, `demac-corporation-web.vercel.app` | `demac-corporation-web` / `prj_bJz7bZZtj8qgj9gX4DHZglyP6Jl7` | `dpl_9qiHNuFvpvhzFCstMURTFACewikC`, READY, `36392f4aabbda65f839008a54edfba799a39329f` | Still the 5 October UI; booking-reference controls are absent. |
| Secondary ERP: `demac-corporation.vercel.app` | `demac-corporation` / `prj_gPKFUmmlG0KzQ0rW9lxUHMde165x` | `dpl_FVYdCZGEhEk9hg2CeQPnk6dCcsLF`, READY, `8f5a0cb280b6e73309dac9e4a4c01af665449147` | New UI was published here only. It shares the production backend. |
| Shared Firebase backend | `demac-corporation`, us-central1 | Nine reviewed functions deployed by run `37660955346` | Already changed before this corrective audit; this is a partial rollout, not an untouched backend. |
| Git main | PR #557 and tooling #558 | `35a6bf79` | Merges completed; merge completion does not establish correct-domain UI publication. |

Both actual `/scheduling/` domains returned HTTP 200 with the ERP auth shell.
That verifies routing only; it does not prove an authenticated user's booking flow.
No production login was impersonated and no real booking was used as a fixture.
Earlier deployment instructions in `docs/ai/releases/projects-scheduling-frontend-20260927.md`
already required verification of both Vercel projects; the previous release omitted that gate.

## Findings and prepared corrections

1. **P1 — Wrong frontend target and false completion report.** The actual ERP domain
   remains on the old UI. The previous report and user confirmations overstated the
   rollout. Correct destination is the `demac-corporation-web` project above. Do not
   repoint the business domain to the secondary project or alter DNS to compensate.
2. **P1 — Stale media recovery after same-day/support changes.** Those producers
   created reference bundles without `referencesVersion`, while the retry authority
   skipped the version check when that field was missing. A synthetic reproduction
   changed references from v2 to v3, removed the file and still resumed the old failed
   bundle. Prepared fix stamps both producers' version and rejects unversioned bundles.
3. **P1 — Failed plain work messages were not revalidated.** Retry checked current
   Work Order, Appointment and references only for media bundles; failed daily text
   could be resumed after cancellation/reassignment/rescheduling. Prepared fix applies
   the same checks to daily work text, includes scheduled time and reference version,
   and preserves the failed record unchanged when obsolete.
4. **Evidence gap — Original owner smoke exercised transport, not complete live booking.**
   The six synthetic sends proved existing native file/voice transport. They did not
   prove the new production upload → booking → bundle → recipient chain or an
   authenticated UI on the actual domain. The earlier browser fixture tested actual
   reference components with synthetic transport, not the complete Scheduling drawer.
   The corrective audit adds the full Scheduling/Booking Authority/emulator path to
   the retained historical Project browser test, including reference persistence,
   exact lost-response retry, ordinary booking without references and mobile controls.

Fixes are confined to producer metadata and manual retry validation. No customer,
Appointment, Work Order, capacity, Project, pricing, payroll, Van mapping or existing
queue record is migrated/rewritten by this audit. The new audit workflow has no deploy
step, never sends WhatsApp, uses loopback-only demo Firestore for writes and restricts
production operations to function/source/scheduler/bridge reads and anonymous probes.

## Verification evidence

- Fresh local baseline rerun: 235 Booking Authority tests; 119 transactional WhatsApp
  tests; 27 gateway/media/office consumer tests. All passed with no skipped tests.
  `test:live-scheduling` passed, including weekly-rest moves, Saturdays, attribution,
  Project labels, capacities, closures and existing communication ownership.
- Two new regression tests failed before the proposed fixes and passed after them.
  They exercise the actual same-day/support producers, allow unchanged bundles to
  resume once, reject substituted/removed references and preserve rejected records.
  Text cases cover cancellation, changed Van/date/time and changed reference version.
  The updated transactional suite passes 121 tests locally.
- Read-only audit run `37667953593` passed for all nine deployed functions, matching
  reviewed source `0f7155ef`, ACTIVE; existing 08:00/08:05/08:10 Aruba scheduler ENABLED.
  At 18:36:05 UTC the unchanged bridge was healthy, zero pending ACKs, no outbound
  error, latest poll 18:36:04.379 UTC. The isolated emulator and desktop/mobile
  reference-component flows also passed in this run.
- Extended audit `37669194464` passed on fix source `05262092191b12eb581a2654f4c6252cd7f97ec5`:
  all nine production sources remained unchanged; both actual business origins passed
  CORS OPTIONS (204) and rejected anonymous POST (401) for Office and reference APIs.
  Bridge remained healthy at 18:45:51 UTC with zero pending ACKs and no outbound error.
  The complete Scheduling drawer → HTTP booking transport → Booking Authority → real
  loopback Firestore path passed at 18:46:37 UTC: historical Project plus reference
  notes, exact lost-response retry without duplicate reference commitment, ordinary
  booking with no reference field, cancel/no-write, reload and mobile controls. Both
  reference-component desktop/mobile scenarios also passed, with zero external requests.
- On that exact code SHA, ERP Next CI (including refresh-browser and field-function
  checks), Office Booking Authority, transactional WhatsApp, Van architecture, both
  typecheck/build runs and both Vercel previews passed. The additional full Project
  historical-bookings workflow `37669344021` was still installing browser tools at
  the final inspection; it remains pending, not waived or counted as passed. The
  targeted full historical Scheduling browser above already passed in the separate
  corrective audit. No release is approved while a required check remains unresolved.

## Reviewable handoff

Draft PR #559 contains the fixes and this corrected record. It is deliberately
unmerged and undeployed. The old report/ADR is marked as partial rollout on this
branch; merged PR #557/#558 descriptions were corrected to remove the misleading
completed-ERP claim. The last recheck of `www.demac-aruba.com` still resolved to
`dpl_9qiHNuFvpvhzFCstMURTFACewikC` / `36392f4a`. Production configuration, domains,
backend code and customer records were not changed during this corrective audit.

## Compatibility, efficiency and remaining limits

The reviewed diff is additive for optional `visitReferences`; existing old-UI requests
without that field do not perform reference ownership reads or change capacity/booking
rules. Reference-only edits merge only that field and its audit/upload claims.
No migration, security-rule update, customer identity replacement, financial rewrite
or automatic deletion of linked media is part of the feature. Orphan cleanup is
bounded and excludes linked files. Existing historical/hold/future notification guards
remain covered by tests. Existing CRM, address completion and support/OT authorities
remain intact; they were not replaced by this feature.

Files are fetched on demand, with sequential uploads, at most 20 files of 25 MiB,
and new buffered endpoints capped at concurrency four / 512 MiB. Gateway reservation
adds Firestore reads even to ordinary sends, and polling scans blocked queue pages;
there is no production latency/load benchmark supporting an unconditional speed claim.
Linked-file retention and at-least-once provider-send/ACK crash semantics remain.
No Google Cloud log scan or forensic customer-data comparison was performed, so the
audit must not be represented as proof of no possible historic data damage.

## Initial release proposal (historical; current execution plan below)

1. Finish and review this branch's fixes and exact-head tests. Keep production on hold.
2. Obtain the owner's decision after this concrete audit; their latest request is to
   verify before applying, superseding the earlier go-ahead for a supposedly safe release.
3. If approved, verify live sources have not moved, then narrowly publish the corrected
   Office retry authority and same-day/support producer; retain the other functions,
   bridge, scheduler, rules and real data. Do not reuse the old release script pinned
   to `0f7155ef` for changed code.
4. Stage a production build of `demac-corporation-web` without domain assignment;
   verify the exact commit, Firebase environment and authenticated synthetic acceptance.
   Promote that tested artifact only after acceptance, then confirm both actual domains
   resolve to it and show the expected controls. Reconcile the secondary project too.
5. No blind backend rollback: pending bundles and locks may already exist through the
   secondary UI. Inspect/reconcile compatibility before any downgrade; never delete
   real records or linked media as a rollback operation.


## Renewed owner authorization and final review — 7 October 2026

The owner explicitly renewed conditional authorization: audit and rectify conflicts,
protect live customers/appointments/workflows, then and only then merge and deploy.
This is authority to execute the bounded release after the required gates pass; no
additional generic approval is needed. It does not authorize test bookings, sends,
migrations, rule changes, secrets or customer-data cleanup in production.

At reviewed head `a54e836ba33b8388b377d911f180783852659152`, all eight Actions runs
passed: `37670373449` (transactional WhatsApp), `37670373453` (Office),
`37670373514` (Van architecture), `37670373497` and `37670364031` (types/build),
`37670373430` (full historical Project suite), `37670373617` (ERP Next), and
`37670364114` (isolated plus read-only corrective audit). Both Vercel previews passed.
The earlier pending historical run is superseded by the successful exact-head run;
its installation cancellation is not counted as a pass. Business domains were again
confirmed at `36392f4a`; secondary UI remained at `8f5a0cb2`.

Fresh Solo Maintainer Adversarial Review, separate from the earlier fix implementation:
rechecked the original feature diff, changed retry paths, their producer/caller graph,
optional booking and overtime input, booking fingerprints/atomic reference claims,
reference-only optimistic concurrency, provisioned office/assigned-technician access,
private media capabilities, cleanup exclusion of linked files, bundle ordering,
ACK cursor recovery, ordinary-message compatibility and the actual Scheduling UI.
The two reproduced retry defects are corrected. No additional release-blocking
application finding was identified. This is not an independent review or a claim of
zero defects; the production latency/provider and authenticated-live limits above remain.

The only changed production modules since the deployed feature are
`vanScheduleCommunicationAuthority.js` (Office authority) and
`technicianScheduleChangeService.js` (appointment notification producer). Therefore
only `officeBookingAuthority` and `queueAppointmentConfirmation` require redeployment.
No other function is selected. The bounded correction script verifies all nine live
sources, preserves each selected function's existing dependency lock, runtime identity,
environment and trigger configuration, and compares the other seven revisions plus
scheduler target/retry/timezone/state before and after. It fails on source drift.
Eleven isolated release/configuration guard tests pass; they exercise rejected branch,
repository, main/source, unknown live source, configuration drift and scheduler drift,
plus the exact two-function successful scope. Credentials are unavailable to these tests.

Execution gates for the final tooling/documentation head:

1. Retain the unchanged reviewed application trees and require all applicable CI and
   both project previews to pass at the final PR head. No required test is removed.
2. Merge PR #559 with `[merge-only]` to prevent automatic broad publication. Create
   only `release/booking-references-correction-20261007` for the guarded two-function
   workflow. Stop UI publication if that release or the bridge check fails.
3. Publish a production build of that exact audited application into the confirmed
   `demac-corporation-web` project. The installed deployment connector does not expose
   no-domain staging. Therefore the build will assign its normal project domains on
   readiness; the reviewed project preview, isolated full-flow tests and bounded backend
   checks must all pass first. Do not alter DNS, repoint domains to the secondary project,
   override ignored-build controls or promote a preview with preview environment values.
4. Verify deployment project, source, production target/readiness, both real domain
   mappings, HTTP route and Scheduling asset controls/Firebase project identity. An
   anonymous auth shell alone is insufficient. Reconcile the secondary project's source
   equivalence. Do not claim an authenticated live customer booking was exercised.
5. Retain `dpl_9qiHNuFvpvhzFCstMURTFACewikC` as the actual UI rollback artifact. Backend
   downgrade is not automatic; old pending bundles must remain compatible. Release
   failure stops subsequent steps and preserves records rather than deleting them.

At this commit publication has not yet occurred. Exact final CI, merge, backend run
and real-domain deployment results will be recorded in PR #559's release evidence.
