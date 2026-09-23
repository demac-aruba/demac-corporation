# Historical Project bookings

Mode: Deep Review, Solo Maintainer Review Mode. Branch: feature/project-historical-bookings.

Owner authorization: the owner accepted completing the pending historical Project workflow after the server persistence, historical crew evidence, audit, retry and reload requirements were explained. Earlier merge/deployment authorization remains conditional on successful verification. No production business records will be created or corrected as tests.

## Scope and acceptance

- Publish existing browser Project planning records explicitly to a shared server registry, validating canonical CRM and booking links; retain the original browser copy for recovery. New records and edits use versioned server persistence.
- Replace a cancelled historical Project booking with a smaller booking using its recorded date, Van and crew. Retain the cancelled original and a reason/operator/time/source audit. Do not use today's crew as historical evidence.
- Use Booking Authority's transaction for the replacement appointment, Work Orders, capacity locks, idempotency and Project assignment link. The original cancellation is a separate existing authorized operation.
- Reject conflicting capacity, a second replacement, foreign links, missing historical evidence, stale planning versions and unauthorized actors. Never fabricate attendance, payroll, physical progress or Field execution. Historical customer notifications remain disabled.
- Verify six cancelled slots plus two replacement slots results in two counted slots, including reload, a second session, retry and concurrent attempts. Preserve regular Scheduling workflows.

Authorities: CRM owns customer/property; Booking Authority owns bookings/capacity; Project registry owns planning/phase identity and links; Field and Payroll retain actuals. Protected rules: OPS-SCHED, OPS-TEAM and historical silent registration. Direct Firestore access remains denied; authenticated service performs writes.

Release: isolated synthetic tests and browser preview first; adversarial self-review and applicable gates before merge/deploy. No deployment of unrelated pending main changes. Import is explicit, idempotent and validated, never a page-load migration.
