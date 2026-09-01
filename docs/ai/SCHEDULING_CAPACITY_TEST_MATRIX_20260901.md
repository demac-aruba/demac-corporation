# Scheduling Capacity Authority regression matrix

This matrix is the merge gate for ADR-SCHED-CAP-001. A row is complete only
when the named automated evidence passes on the audit branch. Existing tests
are retained where they already exercise the canonical authority; new tests
cover the incident, structured diagnostics, projection parity, races, and
future-fleet behavior.

| # | Scenario | Authoritative expectation | Automated evidence |
| --- | --- | --- | --- |
| 1 | Full-day Van; 08:30/09:30/10:30 free; Other 180 at 08:30 | option owns 08:30, 09:30, 10:30 and ends 11:30 | `bookingAuthoritySchedulingEngine.test.js` exact-target manual-duration regression; parity acceptance future-Van open case |
| 2 | Same, 09:30 occupied | reject with capacity conflict diagnostic | `bookingCapacityAvailability.test.js` structured conflict; future-Van parity blocker |
| 3 | Same, 10:30 occupied | reject with exact blocking slot | structured conflict matrix |
| 4 | Half-day Van; 180 at 10:30 exceeds window | reject with half-day/window diagnostic | `bookingCapacityAvailability.test.js` half-day structured rejection |
| 5 | Other manual 1h, 2h, 3h, 3.5h, 6h | exact duration/end/owned-slot count | parameterized engine/manual-duration matrix |
| 6 | Workload 1h -> 3h | previous offer invalidated | create-drawer request-signature acceptance |
| 7 | Rapid 1h -> 2h -> 3h | late response never overwrites latest | create-drawer sequencing/deferred-response acceptance |
| 8 | Cancelled Work Order | no capacity block for all approved spellings | normalized status matrix + projection parity |
| 9 | Rescheduled Work Order | no phantom capacity for all approved spellings | normalized status matrix + lifecycle suite |
| 10 | Partial completion | releases only intended remaining capacity | partial-completion/lifecycle authority tests |
| 11 | Remaining-work follow-up | creates only intended locks | partial-completion/remaining-work authority tests |
| 12 | Normal reschedule | old locks released and new locks atomically owned | `bookingAuthorityAppointmentLifecycle.test.js` |
| 13 | Operational Move | authority rejects conflicts and preserves date policy | scheduling-provider/lifecycle operational-move tests |
| 14 | Support Van | linked support Work Order and exact lock ownership | `bookingAdhocSupport.test.js` and engine support tests |
| 15 | Crew absent/unavailable or Van inactive | reject at operational/crew stage | engine/provider crew regression + operator-safe diagnostic |
| 16 | Route advisory vs enforced | advisory retains explicit target; enforced can reject | scheduling-provider/capacity tests |
| 17 | Approved lunch behavior | real elapsed work and sellable slot ownership remain distinct | capacity and LIVE scheduling acceptance suites |
| 18 | Exact end-of-day boundary | fitting request accepted; overflow rejected | capacity boundary matrix |
| 19 | Duplicate submit | idempotent; one appointment/WO/lock set | Firestore, hold, support and after-hours idempotency tests |
| 20 | Board projection parity | canonical owned/open starts agree | `test:scheduling-capacity-parity` |
| 21 | Hidden/stale WOs after cancel/reschedule/move | normalized nonblocking records release; unknown/unlinked blocker is diagnosed, not silently hidden | status/diagnostic matrix + lifecycle tests |
| 22 | Multiple work lines | one trusted combined workload/allocation | scheduling-engine/provider mixed-work tests |
| 23 | Same-day past start | board non-actionable; authority reports `START_TIME_PASSED` | engine/provider diagnostic test + board clock acceptance |
| 24 | Offer expires or inputs mutate during commit | UI freezes captured intent; backend revalidates version/state | create-drawer race tests + Firestore revalidation test |
| 25 | Arbitrary future Van from registry | 08:30/180 accepted; 09:30 conflict rejects; cancellation restores | identity/engine tests + `test:scheduling-capacity-parity` |
| 26 | Rename identity invariance | only changing Van ID cannot change capacity answer | generated parity acceptance |
| 27 | Runtime fleets of 1/5/8/15 Vans | no fixed fleet-count behavior | generated parity and dynamic board/registry acceptance |

## Required commands

```text
cd functions
npm run validate:firebase
npm run test:booking-authority
npm run test:transactional-whatsapp

cd apps/erp-next
npm run test:live-scheduling
npm run test:scheduling-capacity-parity
npm run test:van-profile
npm run typecheck
npm run build
```

The final task evidence records the exact pass counts and any command that was
not run. Preview/mobile verification is additional evidence; it does not replace
the authority tests.

## Audit-branch result — 2026-09-01

All 27 matrix rows passed on `refactor/scheduling-capacity-authority-20260901`.

| Gate | Result |
| --- | --- |
| `npm run validate:firebase` | PASS |
| `npm run test:booking-authority` | 226/226 PASS |
| `npm run test:transactional-whatsapp` | 115/115 PASS |
| `npm run test:customer-agent-tools` / router | 78/78 and 1/1 PASS |
| ERP typecheck | PASS |
| LIVE scheduling | PASS; five acceptance scripts |
| Scheduling capacity parity | PASS |
| Dispatch / lifecycle / Booking Intelligence / Booking Copilot / Van profile | PASS |
| Production boundary | PASS; 65 App Router entries isolated from legacy solvers |
| `npm run build -- --webpack` | PASS; 54 routes, including all prebuild employee gates |

No production mutation scenario was run because the owner did not authorize a production deployment or `main` merge.
