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
available locally after the initial blocked attempts. CI is still not published or run.
Read-only immutable deployed-source/configuration/IAM comparison also remains pending.

## Decision
- [ ] Pass
- [ ] Pass with recorded follow-up
- [x] Block release until deployed-source comparison and publication authorization are complete

The automatic approval reviewer rejected the branch push because this repository is
public; explicit authorization to publish these source changes is still needed.
Merge/deploy was requested by the owner, but has not occurred.

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
