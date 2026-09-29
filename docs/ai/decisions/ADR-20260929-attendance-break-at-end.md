# ADR-20260929: Apply unused break to early departure in shared attendance calculation

- Status: Accepted business intent; implementation pending review and release approval
- Date: 2026-09-29
- Owner: DEMAC business owner
- Rule: `OPS-STAFF-ATTENDANCE-BREAK-END`
- Supersedes: blanket no-offset wording in BUSINESS_RULES.md only for this specific case

## Context and decision

The owner requested continuous-work shifts that finish early in lieu of taking the
scheduled break. Use the existing shared attendance calculator for both ERP Next and
Work Order integration. For a clock interval overlapping the scheduled shift, apply
`min(unused scheduled break, raw early departure)` before capping missing time. Only
the unused remainder contributes to overtime. Place the shifted break at the end of
the schedule when describing any uncovered departure interval.

Keep original Clock In, Clock Out and Break Minutes. An altered clock/break is an
explicit exception even when its payroll totals equal a normal day. No synthetic
break, absence classification or paid-free time is needed for the covered interval.
Late arrivals and overtime from working outside the shift retain existing treatment.

## Alternatives and consequences

- UI-only unblocking would persist inconsistent payroll amounts: rejected.
- Netting all overtime against all missing time changes unrelated attendance rules: rejected.
- New attendance collection or backfill is unnecessary: retain canonical schedule and
  employee/date timesheet, permissions, audit fields and existing save path.
- Old persisted records are not silently rewritten; edits use the revised rule. An
  existing Work Order recomputation may also update overtime on its affected timesheet.

## Verification and rollout

Regression evidence covers the requested departures, partial breaks, residual absences,
late arrival, partial-day schedules, external work intervals, save/retry and payroll.
Release requires review, passing applicable gates and explicit merge/deploy approval.
Rollback is a code revert; production data corrections require explicit scope and authority.
