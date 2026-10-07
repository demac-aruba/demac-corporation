# Review: previously unscheduled historical Project registration

## Review mode

Solo Maintainer Adversarial Review, separate from implementation; not independent.
Author/reviewer: Codex. Re-read Christian's request and the screenshot, then reviewed
all production changes, test fixtures, authority/rule updates and direct callers.

## Scope and adversarial findings

- `readProject` still requires the authenticated office channel, provisioned Project
  scheduler, exact Project version, Customer/Property and phase. Historical intent
  now requires explicit acknowledgement instead of a blanket rejection.
- `officeBookingAuthorityPartialWrapper` decorates the actual production provider
  with this same Project link service. Both availability and transactional commit
  recheck authorization; Project-linked replay also rechecks the current role.
- `assertBackdatedCreateIntent` binds offer metadata to confirmation and prohibits
  historical holds. `projectHistory` recovery offers still require the dedicated
  manager authority. No history-adjustment or Project-planning permission changed.
- Published Project linkage, claim, Appointment, Work Order and locks remain atomic.
  Unpublished browser Projects are explicitly blocked for this new historical path.
- The existing historical provider revalidates dated crew/calendar/capacity; no
  conflict/absence/closure exception was introduced. Existing Project lifecycle
  restrictions (including Completed/Cancelled/On Hold) are preserved.
- Persisted work-already-performed markers and actor/time evidence are reused;
  automatic recipients/messages are suppressed. No Field completion, payroll,
  actual hours or financial state is invented.
- Retrying a lost response reuses the original offer/option/request and creates one
  link. Competing bookings do not both win historical capacity.
- No unresolved production-code finding. Rollout must update officeBookingAuthority
  before ERP Next. Existing records and historical audit must not be deleted on rollback.

## Verification

| Check | Result |
| --- | --- |
| Focused backend: Project operators, Office API, Booking Authority persistence, scheduling provider/engine, Project records | PASS: 96 tests, zero skipped |
| Real Firestore `projectBackdatedBooking.emulator.test.cjs` | PASS: 6 tests, zero skipped; all four Vans, owner/operator aliases, elapsed today/prior date, acknowledgements, hold rejection, conflicts/closure/absence, stale Project, revoked user, retry/races |
| ERP `test:live-scheduling`, `test:projects-preview` | PASS |
| ERP `typecheck` | PASS |
| ERP `build`, including required prebuild suites | PASS |
| Functions `validate:firebase` and new script syntax | PASS |
| Real Chromium functional flow in `backdated-project-browser.cjs` | PASS: six scenarios; cancelled acknowledgement, historical Project registration, exact lost-response retry, persisted agenda after reload, regular service backdating and mobile Project drawer. Zero page errors/external requests. |
| Additional `agent-browser` CLI smoke at the end of the browser script | BLOCKED/FAIL: daemon cannot bind its local socket (`Operation not permitted`). The script retains nonzero exit; this check is not represented as PASS or waived. |
| Complete diff / whitespace / unrelated generated output | PASS; build-generated Next config/type changes excluded |

The browser script writes `integration-result.json` after its functional assertions
and before the auxiliary CLI check, so a functional PASS cannot conceal the later
blocked CLI check. Actual React, HTTP transport, Office API and Firestore were used;
only session/auth, transport destinations and clock were synthetic. No production
customer data or accounts were used or modified.

Initial fixture-only failures (HTTP 409 rather than 400, absence field names) were
corrected against the existing contracts. The build's out-of-tree dependency symlink
was replaced with local dependencies. No required test or assertion was disabled.

## Decision and residual limit

Implementation and functional validation complete. Additional CLI smoke remains
blocked by this execution environment and is explicitly escalated in the PR. Run
that retained check in an environment supporting local Unix sockets before claiming
all checks passed, or obtain an explicit disposition accepting the completed real
Chromium functional coverage. This is a tooling limit, not an observed application
failure. No independent review is claimed. Merge/production deployment still require
owner approval under AGENTS.md; no deployment or production writes performed.
