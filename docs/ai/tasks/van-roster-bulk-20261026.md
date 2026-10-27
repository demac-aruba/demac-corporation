# Task: Save the complete Van roster atomically

Owner request 2026-10-26: exchange employees freely, save once, preserve real work and
keep payroll, recurring partial days, dispatch and technician access consistent.
Merge and production deployment are explicitly authorized in this conversation.

## Mode and authorities
Deep Review; separate Solo Maintainer Adversarial Review. `vans` remains regular
crew authority; `vanHalfDaySchedules` remains recurring schedule authority. Embedded
effective crew versions preserve membership on prior dates. Staff primaryVanId and
linked users.vanId are compatibility metadata. Recurring Van rules are not edited here.
Booking owns appointments/work orders, Field owns execution evidence, timesheets
remain payroll actuals. WhatsApp mappings remain attached to physical Van identity.
Rules: OPS-VAN-PROFILE-001/002, OPS-STAFF-SCHEDULE, OPS-STAFF-ATTENDANCE.

## Acceptance and failure behavior
- One roster draft for the whole fleet; intermediate incomplete/duplicate selections
  are allowed; one final server-validated transaction and exact-request retry.
- Fresh operations authorization, fleet version, active technical employee and driver
  eligibility, complete available crews, regular and dated uniqueness.
- Effective today in Aruba; historical payroll resolves prior crew membership and the
  corresponding Van rule. This change does not version unrelated weekly-rule edits. Existing
  attendance, completed visits, finance and customer identity are never rewritten.
- Update pending current/future work and appointment crew snapshots; preserve Van,
  booking placement, capacity locks, prices and WhatsApp group mapping.
- In-progress execution, incompatible overrides, stale drafts and oversized commits
  fail before any write. Explain the conflict and retain the draft.
- Append actor/time/before/after audit. Compatibility primaryVanId follows canonical crew.
- Protect managed roster fields from obsolete direct-write clients.
- Revalidate a prepared booking's crew inside its commit transaction, preventing an
  old availability offer from restoring pre-transfer personnel.

## Verification and recovery
Synthetic transaction, concurrency, retry, authorization, history/payroll, work/dispatch
tests; ERP typecheck/build and browser draft/swap/error checks; Firebase validation and
rules emulator allow/deny tests. Source-only production release with retained baseline
and unchanged runtime configuration; read-only postrelease checks. No test employee
movements, queue flushing or old message replay in production.

## Delivery status
Published as PR #630 after explicit public-source authorization on 2026-10-27.
Latest overnight payroll update `7c0f6da` is integrated. Local and GitHub roster
browser/emulator/domain checks passed; immutable Office source and Rules audits passed.
Controlled source-only release and nineteen recovery/scope checks are prepared.
Final-head CI, merge, backend/rules publication, propagation hold and ERP verification
remain required. No production employee/customer data mutation or messages were used.
WhatsApp destinations remain the canonical Van groups. The current bridge does not
provide participant-membership management; automatic group enrollment is not delivered
by this change and must be resolved before claiming complete messaging automation.
See [adversarial review](../reviews/van-roster-bulk-20261026.md) and
[decision](../decisions/ADR-20261026-atomic-van-roster.md).
