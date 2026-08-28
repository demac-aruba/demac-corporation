# Business Rules

The detailed approved registry is `docs/DEMAC-company-rules-v1.md`. This file is the
engineering index; it does not replace that registry.

## Source precedence

1. Approved operational and pricing settings named in the company rules registry.
2. Protected scheduling, routing, integrity, and communication rules in versioned code.
3. Catalog descriptions and approved knowledge rules.
4. UI defaults only when no authoritative rule is required.

## Protected rule families

- `PRICE-*`: prices and durations must come from approved data; never infer missing values.
- `OPS-SVC-*`: capacity includes the six-slot day, seven-unit single-property exception,
  and governed multi-van support.
- `OPS-TEAM-*`: driver authorization, absence, availability, and no simultaneous assignment.
- `OPS-ROUTE-*`: route anchors and calculated availability precede customer preference.
- `ERP-SCHED-*`: employee lifecycle dates, Sunday closure, custom shift precedence, recurring
  partial-day policy, and one governed resolver for calendar/attendance/payroll.
- `COMMS-*`: current-turn priority, answer-first behavior, natural language, contextual
  option selection, hidden internal van splitting, one confirmation, and no invention.

## Change protocol

Every rule change needs a stable ID, owner, source/evidence, effective date, affected
authorities, acceptance examples, regression tests, and migration impact. Configurable
values belong in governed settings; integrity and safety invariants remain protected code.
Ambiguity blocks automation and is escalated to an authorized human.

## Current operating-calendar ownership

- `ERP-SCHED-001`: Sunday is globally closed and cannot be overridden by an employee or
  Van/team schedule.
- `ERP-SCHED-002`: Monday through Saturday use the normal company schedule unless an active
  employee custom schedule or governed technical Van/team fallback resolves differently.
- `ERP-SCHED-003`: an explicit employee custom schedule is persisted in
  `employeePayrollSettings` and can define an 08:00–17:00 or 09:00–18:00 shift with a
  one-hour break; DEMAC custom shifts resolve to eight paid work hours after the break.
- `ERP-SCHED-004`: each custom employee schedule may assign one recurring partial-day
  weekday from Monday through Saturday. Office/admin/operator policy is 4 worked hours +
  4 paid-free hours; technician/field policy is 5 worked hours + 3 paid-free hours.
- `ERP-SCHED-005`: technical field employees with no active explicit employee custom
  schedule inherit their recurring partial day from the canonical Van/team through
  `vanHalfDaySchedules`.
- `ERP-SCHED-006`: schedule resolution precedence is employment lifecycle → Sunday closure
  → active employee custom schedule → technical Van/team fallback → company default.
- `staffAbsences` remains separate and represents dated vacation, sickness, or one-off
  unavailability; it never becomes a recurring partial-day rule.
- `dailyVanAssignments` is a date-scoped temporary crew assignment/override and does not
  redefine recurring ownership.
