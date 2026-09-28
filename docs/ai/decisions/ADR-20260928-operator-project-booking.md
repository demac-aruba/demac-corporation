# ADR-20260928: Separate Project scheduling from Project management

- Status: Proposed
- Date: 2026-09-28
- Owners: DEMAC ERP owner and Engineering
- Related task/rules: [operator Project booking](../tasks/operator-project-booking-20260928.md), `OPS-PROJ-SCHED-001`
- Supersedes/superseded by: none

## Context

Office Operators can create Regular Bookings but the ERP hides Project booking because
the `projects.view`/`projects.manage` gates and Project backend manager role checks
exclude them. The owner requests booking existing Projects, not Project creation or
planning edits. Simply granting `projects.manage` would widen planning, historical
correction and potentially financial access beyond that intent.

## Decision

Introduce `projects.schedule` for active Office Operators and existing scheduling
managers. Project Authority provides an authenticated scheduling-only projection of
published Projects. Booking Authority authorizes the schedule role at offer validation
and transaction commit, then writes Appointment, Work Order, capacity locks and Project
link atomically. The `projectRecords.save` and historical correction paths keep their
existing manager-only authorization. Operators do not load browser-local Project drafts.

## Alternatives considered

| Alternative | Benefits | Costs/risks | Why not selected |
| --- | --- | --- | --- |
| Grant `projects.manage` to Office Operators | Minimal UI edit | Opens Project planning and historical writes | Exceeds owner request and least privilege |
| Grant `projects.view` plus full Project list | Simple read path | Discloses financial/operational fields not needed to book | Use a scoped projection |
| UI-only Project button | Visual quick fix | Server rejects list and booking; cannot work | Authorization belongs at the server |

## Consequences

- Positive: operator Scheduling can book an existing shared Project without a second
  Appointment, Project store, or capacity authority.
- Negative/tradeoffs: one additional Project read projection and explicit permission
  path must be maintained.
- Security/privacy: schedule-only response must exclude contract, materials, expenses,
  costs and manager-only planning details; server authorizes every read and booking.
- Scalability/operations: follows the existing bounded Project portfolio list; future
  pagination is still required when the existing portfolio cap is reached.
- Migration/compatibility: no migration. Existing manager flows and Regular Booking
  should remain unchanged.

## Verification and rollout

- Acceptance evidence: focused positive and negative authorization tests, ERP and
  Functions gates, owner preview of Office Operator flow.
- Observability: permission denials return explicit errors; canonical Project booking
  claims and existing Appointment/Work Order audit remain the operational evidence.
- Rollback or forward recovery: revert API and UI authorization together; no data
  rewrite. Never publish frontend-only permission changes before backend support.
- Review date/triggers: review if Project read scope or historical operator workflows
  expand.
