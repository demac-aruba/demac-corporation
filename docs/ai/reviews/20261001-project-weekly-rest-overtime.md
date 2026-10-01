# Review: Project bookings in weekly rest

## Review mode and scope

Solo Maintainer Adversarial Review — Codex implemented and then separately reviewed
the complete diff, the production office facade, Project link participant, special
booking transaction and frontend confirmation/recovery callers. This is not an
independent review.

Source: Christian's 1 October 2026 request and
`../tasks/20261001-project-weekly-rest-overtime.md`.
Rules: OPS-SCHED-PLANNED-OT-002 / OPS-SCHED-PLANNED-OT-PROJECT.

## Findings resolved

- The initial UI restriction was only part of the defect. The special endpoint also
  needed canonical Project metadata and atomic Project linkage; simply showing the
  toggle would have created unlinked work.
- Over-budget acknowledgment previously depended on a standard availability offer.
  Weekly-rest Project bookings now bind their budget warning to their exact current
  Project, phase, version and workload without opening ordinary availability.
- Browser-only drafts must not enter this new atomic path. Their selection is
  disabled until published; the backend independently requires the shared record.
- Exact replay must survive the Project version increment yet recheck current
  permission. The existing replay authorizer is used inside the transaction.
- The client verifies returned Project and phase fields on both Appointment and
  Work Order; it cannot report a verified link when that response is incomplete.

## Verification

| Check | Result |
| --- | --- |
| ERP Next TypeScript | PASS |
| Firebase syntax validation | PASS |
| Project preview acceptance | PASS |
| Live scheduling, Saturday drag, attribution, cards and Project labels | PASS |
| ERP Next production build and all existing prebuild gates | PASS |
| `node --test functions/officeBookingAuthorityFacadeProject.test.js functions/bookingAfterHours.test.js functions/projectOperatorBooking.test.js` | PASS, 46 tests |
| Firestore emulator `bookingRestDayOvertime.emulator.test.cjs` | PASS, 13 tests, zero skipped |
| Browser integration assertions using real React, transports, office facade, Project API and loopback Firestore | PASS, 20 scenarios, zero page errors or external requests |
| Optional agent-browser CLI smoke at the end of the browser runner | FAIL / environment limitation: daemon cannot bind its Unix socket (`Operation not permitted`) |
| Production booking, merge or deployment | Not run; owner approval required |

The browser runner preserves its nonzero exit for the CLI smoke; it is not presented
as an overall passing command. Its independently written integration-result.json
records the completed functional browser assertions. The actual Chromium UI path
was exercised and screenshots inspected, including Project selection, whole slots,
phase, budget cancellation, overtime cancellation, response-loss exact recovery and
persisted Project labels after reload. The CLI environment limitation does not
indicate a failed application assertion; no test or gate was removed or weakened.

Negative backend cases cover missing/stale consent, changed Project/scope, stale
versions, customer/property mismatch, missing/closed Project, link limits, role
revocation, unprovisioned operator, reservation conflict and unsupported special
paths. Emulator races verify one winner and no orphan Project link for both duplicate
and distinct requests. No actual timesheets, payroll or outbound messages are written.

## Decision and residual risk

Application checks pass; the separate CLI smoke remains environment-blocked as
recorded above. No unresolved application correctness finding from this review.
Final GitHub CI status must be checked before merge. No production data was used.

Rollout order after owner approval: deploy officeBookingAuthority, then the ERP Next
frontend. Deploying only the frontend against the old special endpoint is not a
supported rollout. No migration or security-rule change is required. Production
smoke remains an authorized post-deployment step; the owner validates business use.
