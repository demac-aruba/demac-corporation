# Project in-place historical slot correction

- Status: Proposed, pending final review and release approval
- Date: 2026-09-23
- Owners: DEMAC Operations / Booking Authority
- Related task/rules: `docs/ai/tasks/project-history-finance-guard-20260923.md`; OPS-SCHED, OPS-TEAM
- Supersedes/superseded by: supersedes the new-write cancel/replacement approach in `project-registry-historical-bookings.md`; historical records remain readable.

## Precedence rule

This proposed decision reflects the owner's revised requirement for new Project slot corrections. Do not deploy it until its final review, CI and human approval gates pass. Existing correction records are not deleted or rewritten.

## Context

Operations needs to correct a past Project Van allocation after learning that fewer or more slots should have been reserved. Cancelling and replacing the booking changes its identity and makes planning/capacity reconciliation harder. Technician hours and Field execution are separate authority boundaries.

## Decision

Booking Authority changes a confirmed, past, single-Van, unexecuted Project booking **in place**: same Appointment and Work Order IDs, original date/start/Van/crew, 1–6 whole slots, and only a contiguous trailing change. The Appointment, WO, capacity locks, Project assignment and append-only request audit change in one transaction after fresh authorization and commit-time evidence checks. Project budget usage is derived from linked noncancelled WOs; the legacy scheduled counter is rebuilt from unposted links. Neither actual labor nor approved budget is rewritten. No customer notification is sent.

Any Field execution or local commercial evidence blocks. The operator explicitly attests no billing, including outside ERP, for each new correction; this is not a QBO lookup or guarantee. Over-budget increases require separate explicit acknowledgement and audit. Existing cancel/replacement records stay readable. The old recovery endpoints remain narrowly available only for an already-cancelled clean Project booking; they cannot replace a confirmed booking and have no new cancel/replacement UI.

## Alternatives considered

| Alternative | Benefits | Costs/risks | Why not selected |
| --- | --- | --- | --- |
| Cancel and replace | Reuses Booking Authority creation | Changes identity; summary and correction chain become harder to reconcile | Revised owner requirement is in-place correction. |
| Edit only Project counter | Small UI change | Contradicts canonical Scheduling and Van capacity | Booking Authority is slot owner. |
| Edit technician actual hours from slots | Appears to reconcile labor | Invents Field/payroll truth | Actual hours require their own authority. |

## Consequences

- Positive: same booking identity and canonical capacity, deterministic retry and audit.
- Negative/tradeoffs: only clean single-Van history qualifies; executed or billed work needs separate governed reconciliation.
- Existing Project-linked reschedules may have stale Project assignment date/start/Van/crew metadata; in-place adjustment fails closed on that mismatch pending separate Project-link reconciliation.
- Security/privacy: server-only role and transaction controls, no new client Firestore write permissions.
- Scalability/operations: each correction reads linked Project WOs and same-day WOs; existing Project assignment bound applies. Larger portfolios need pagination/subcollections.
- Migration/compatibility: no migration; historical replacement records remain as immutable evidence.

## Verification and rollout

- Acceptance evidence: focused unit tests, emulator/ERP browser acceptance and independent review before release.
- Observability: `projectCapacityCorrections` records actor, reason, attestation, before/after slots, budget forecast and exact request ID.
- Rollback or forward recovery: disable API without deleting records; retry exact request ID after uncertain response.
- Review date/triggers: before any external billing/QBO integration becomes active, or if multi-Van/executed-work correction is requested.
