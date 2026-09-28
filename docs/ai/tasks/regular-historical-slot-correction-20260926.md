# Task: Correct past Regular Booking capacity slots in place

## Context

- Request/source: DEMAC owner asked to correct backdated Regular and Project allocations after the actual visit differed from the original plan. Historical Project slot correction is already published; this task covers the remaining Regular Booking reservation correction.
- Product surface and users: Office Scheduling, authorized scheduling operators.
- Current behavior/evidence: canonical historical Regular Booking creation exists, but correcting its reserved Van slots requires a guarded in-place authority and operator entry point.

## Scope

- In scope: change a confirmed, past, single-Van, one-hour-per-unit Regular Booking from 1–6 whole reserved slots to a different count, up or down; preserve appointment and Work Order identity; update only their planned duration/capacity and owned locks; audit the reason and actor; reconcile stale state and exact retries.
- Out of scope: Project bookings (separate authority), fixed or multi-hour-per-unit service bookings, seven-unit exception, worked time/Field records, service scope/quantity/price, payroll, invoices/payments, and customer messages. Bookings with evidence of these downstream effects must be denied and reconciled separately.
- Files/boundaries expected: existing Office Booking Authority action, its transaction, Scheduling UI/client, focused contracts and acceptance documentation.

## Governance

- Authority owner(s): Booking Authority owns Van/crew capacity and canonical Appointment/Work Order schedule; Field owns executed work; financial authorities own invoices/payments.
- Business-rule IDs: OPS-SVC-001 and OPS-SCHED-BACKDATE-001.
- Security/privacy impact: authenticated scheduling role only; no new permissions, notifications or real-data fixtures.
- Legacy parity impact: preserve existing Regular Booking creation/move, Project historical correction and 3+3 sellable slot calendar.
- ADR/debt impact: no new source of truth; no ADR unless review finds a boundary change.

## Acceptance criteria

- [ ] A past confirmed Regular Booking with one Van and consistent canonical records can be decreased/increased by whole slots, including a 3→4 lunch crossing, without creating another appointment or Work Order.
- [ ] The Appointment, Work Order and capacity locks agree after commit; elapsed work end and sellable-capacity end remain distinct across lunch.
- [ ] A stale slot count, occupied Van/crew, Project link, Field actual, commercial evidence, ambiguous legacy record, nonstandard duration or unauthorized actor fails closed with no writes.
- [ ] Exact retry is no-write and cannot undo a later correction; reused request ID with different details is rejected.
- [ ] UI requires reason and explicit no-billing acknowledgment, shows the correction only for eligible past regular bookings, refreshes the agenda after success, and sends no customer notification.

## Plan and risk

- Implementation outline: add a scoped Office Booking Authority transaction and a Scheduling correction panel; use canonical appointment reload and stable request IDs.
- Migration/rollback or recovery: additive API/action and audit collection, no bulk migration; disable entry point on rollback and preserve committed audit/locks for forward reconciliation.
- Key risks and mitigations: cross-lunch end confusion, lock contention, stale edits, hidden Field/commercial evidence and replay after another edit. Cover with focused and transitive tests plus independent review.

## Verification

- Automated gates: Functions focused and Firebase validation; ERP typecheck/build and relevant Scheduling acceptance; no weakening or skips.
- Manual scenarios: synthetic past Regular 3→4 and 4→2, conflict/denial, retry/reload, customer notification absence.
- Evidence/results: pending implementation and review.
- Not run and why: live customer-data correction is not an acceptance test.
