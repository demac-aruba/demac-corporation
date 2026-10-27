# Review: atomic fleet crew changes

## Review mode
- [x] Solo Maintainer Adversarial Review
- [ ] Independent Review

Reviewer and implementation author: Codex. This is a fresh adversarial self-review
after the initial implementation, not an independent review.

## Scope
Diff from main `7c0f6da` after integrating the overnight-attendance update; initial
implementation `04d848e` plus review corrections. Local integration commit `adc2c27`.
Reviewed the roster editor, transport, authenticated facade, transaction and rules;
date-based payroll and agenda resolution; prepared booking confirmation; pending
Work Order, Appointment and Project links; Field membership and linked login metadata;
schedule-notification consumers and existing source-only release tooling.

Authorities: vans owns regular membership; vanHalfDaySchedules owns recurring hours;
employeeTimesheets owns recorded attendance; Booking owns planned work; Field owns
execution. Rules: OPS-VAN-PROFILE-001/002, OPS-STAFF-SCHEDULE and OPS-STAFF-ATTENDANCE.

## Findings and corrections
| Severity | Finding | Resolution |
| --- | --- | --- |
| High | Per-Van writes make valid exchanges impossible | Shared draft and one server transaction; final-state validation |
| High | Current membership can alter historical payroll inference | Embedded effective crew history; date-based payroll and agenda readers; recorded timesheets preserved |
| High | Pending work, project planning and login compatibility can retain old workers | Atomic updates to planned links, staff primaryVanId and linked users.vanId |
| High | A prepared booking can commit old crew after a concurrent transfer | Re-read managed crew, dated overrides and availability inside the booking transaction |
| High | Incomplete execution markers or orphaned planning links could permit rewriting actual work | Shared execution-marker check, exact Appointment/Project links and visit guards |
| High | Response loss can cause a duplicate or contradictory save | Request fingerprint and private audit; retain exact request before dispatch and retry with fresh authorization |
| Medium | Repeated same-day changes at the same timestamp can select the first version | Last matching effective version wins; repeated-transfer regression |
| Medium | Old profile/maintenance draft could replay stale crew | Strip roster-owned fields and validate the fresh existing crew; rules reject direct roster mutations |
| Medium | Browser storage failures can abandon pending state | Retain protected retry state and report the failure |

## Verification
Local focused domain/consumer/overnight-attendance suite: 159 tests, including authorization denials,
atomic rollback on invalid drafts, two competing saves, response-loss replay,
execution/visit/absence/dated-override conflicts, preserved financial/attendance data,
prepared-booking concurrency, notification routing predicates and Field membership.
Payroll acceptance passes: prior and new Van partial-day hours, protected Sunday,
agenda historical crew, preserved saved schedule and overtime classification.
ERP production build (including all existing prebuild suites), TypeScript, Firebase
validation and whitespace checks pass locally. The build-generated Next configuration
changes were restored; they are not part of the patch. No production employee moves
or outbound messages were used as tests.

Local real Firestore emulator tests: 3 passed, including concurrent transaction
serialization/retry, fresh authorization, private audit isolation and old-client
crew/history write denial for both Office and Admin; ordinary vehicle maintenance allowed.
Firestore emulator 1.19.8, Java 17, firebase client 13.0.0 and rules-unit-testing 6.0.0.
The isolated demo project and loopback endpoint were enforced before any request.
Desktop (1440 px) and mobile (390 px) browser scenarios passed with Chromium 143:
draft survives Van navigation, invalid duplicates retain the draft without writes,
successful swap updates planned work, response loss locks the same request, and
reload/retry does not repeat the transfer. Screenshots visually inspected; no horizontal
page overflow or browser errors. All data was synthetic. Test dependencies became
available locally after the initial blocked attempts.

Publication authorization was explicitly confirmed on 2026-10-27; PR #630 is open.
GitHub roster CI (40546482181) passed domain/payroll, browser and real-emulator gates.
The read-only production audit (40546468240, commit ff02340169e6f8eaace308eea115b44dec5876d8)
passed: exact live Office revision officebookingauthority-00091-nac, pinned dependencies,
74 baseline tests and 103 candidate tests plus actual bootstrap/CORS/anonymous-denial
smoke. Runtime configuration, IAM and live traffic stayed unchanged. Immutable results
are in ../releases/van-roster-audit-20261027.json. Rules baseline includes the deployed
overnight-attendance guard; only the Vans writer block changes.

Release tooling received a separate adversarial review: exact main/release SHA gates,
source-only update mask, six-file runtime delta, immutable private recovery ZIPs,
operation provenance, safe response-loss resume, unchanged configuration/IAM/traffic,
Rules drift rejection and ten-minute Rules propagation hold before frontend publication.
Nineteen local release-safety tests passed. No production invocation with a valid user
or employee/customer documents is needed for these checks.

CI exposed a stale property-message assertion that expected English "Apartment" despite
an explicitly Spanish recipient and the existing translated address contract. The test
now requires the full Spanish address line for customer and technician text and still
asserts that the original English snapshot is preserved and a later rename is absent.
No message-rendering behavior changed. Final-head CI must confirm this correction.

## Decision
- [ ] Pass
- [x] Pass with recorded follow-up
- [ ] Block release until deployed-source comparison and publication authorization are complete

The owner explicitly authorized public source publication, merge and deployment.
The technical review passes with the limitations below. Merge requires final-head CI;
production rollout remains pending the controlled release and postdeployment proof.

Residual risks / next checks, owned by maintainer before merge:
- WhatsApp routing stays with the Van group; the bridge does not manage participants.
  Confirm the enrollment workflow before claiming every moved worker receives group messages.
- Dated overrides remain explicit exceptions; incompatible existing exceptions block the
  transfer. Old direct override writers retain their existing validation limitations.
- Started work blocks crew changes for its lane instead of rewriting execution. Completed
  work remains untouched. This may require an end-of-workday transfer.
- The transfer takes effect for the Aruba business date, not an intraday payroll split.
  Existing saved attendance remains authoritative.
- A maximum 1000 future orders/overrides, 450 document writes and 512 embedded history
  entries bound transaction size. Exceeding a bound rejects before writes.
- Deployment must target the ERP project, officeBookingAuthority and reviewed rules only,
  preserving runtime configuration and current unrelated production source.

## Final CI queue repair
The former Office workflow serialized all pull-request checks with production and had
no timeout on its dependency/browser installation. A superseded synthetic run stalled
and prevented the final revision from starting. PR checks now use a per-PR concurrency
group and cancel only superseded PR runs; production retains the exact existing global
non-canceling group and the separate privileged publication lock. The financial check
has a 25-minute failure timeout. No test, assertion, permission or deployment gate was
removed or weakened; current-revision checks must all pass.
