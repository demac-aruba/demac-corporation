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
- `OPS-STAFF-SCHEDULE-*`: employee schedule authority, employment-date boundaries, recurring
  partial-day ownership, effective schedule versions, exact worked-hour windows, and Sunday closure.
- `OPS-STAFF-ATTENDANCE-*`: 27–26 payroll-period membership, schedule-derived overtime,
  separately classified partial missing-time segments, and explicit attendance schedule snapshots.
- `COMMS-*`: current-turn priority, answer-first behavior, natural language, contextual
  option selection, hidden internal van splitting, one confirmation, and no invention.

## Change protocol

Every rule change needs a stable ID, owner, source/evidence, effective date, affected
authorities, acceptance examples, regression tests, and migration impact. Configurable
values belong in governed settings; integrity and safety invariants remain protected code.
Ambiguity blocks automation and is escalated to an authorized human.

## Current operating-calendar ownership

- Sunday is globally closed and cannot be overridden by an individual employee schedule.
- Monday through Saturday are normal operational days unless canonical closure or capacity
  configuration says otherwise.
- Office/non-technical employees may use the company schedule or an effective individual
  eight-work-hour full-day schedule in `employeePayrollSettings`; the approved primary templates are
  08:00–17:00 with a one-hour break and 09:00–18:00 with a one-hour break.
- An office/non-technical employee's recurring partial day belongs to
  `employeePayrollSettings`. Its Start, End, and optional Break are stored as exact worked-time
  values. Attendance and payroll count the resulting worked hours only; the system must not add a
  synthetic paid-free block.
- A technical field employee's recurring partial day belongs to the canonical Van/team through
  `vanHalfDaySchedules`. The exact Van/team Start and End determine the worked hours. An
  employee-level payroll schedule must not override the Van/team rule, and no synthetic paid-free
  hours are added.
- Effective employee schedule versions preserve historical schedule resolution instead of
  retroactively applying a later schedule change to earlier payroll/attendance dates.
- `employmentStartedAt` and `employmentEndedAt` bound synthesized schedule/attendance/payroll
  days: dates before the start or after the end resolve to zero scheduled hours; boundary
  dates themselves are inclusive.
- `staffAbsences` remains separate and represents dated vacation, sickness, or one-off
  unavailability; it never becomes a recurring partial-day rule.
- `dailyVanAssignments` is a date-scoped temporary crew assignment/override and does not
  redefine recurring ownership.

## Current payroll-attendance ownership

- Payroll attendance periods are canonical 27th-through-26th ranges. The selected day is a
  child selection inside that range; selecting July 27 in the July 27–August 26 period does
  not change the payroll period to July.
- Normal scheduled attendance remains synthesized from the canonical employee schedule.
  Explicit `employeeTimesheets` records are created only for payroll-relevant exceptions.
- For a worked day, overtime is derived deterministically from the resolved schedule and
  actual Clock In, Clock Out, and Break Minutes. Early start, late finish, and unused
  scheduled break add independently; overtime is not a manual payroll input.
- Late arrival, early departure, and break time beyond the scheduled break are independent
  missing-scheduled-time segments. Each segment must be explicitly classified as Paid or
  No Work No Pay and carry a reason before it can be saved.
- Overtime and missing scheduled time never offset each other. Payroll retains both facts.
- Paid partial missing time contributes to paid-free time; unpaid partial missing time
  contributes to No Work No Pay. A partially affected employee can remain `Present`.
- New or edited explicit attendance records preserve an additive snapshot of the resolved
  scheduled start, end, break allowance, and scheduled paid-free minutes. Existing records
  without snapshot fields remain valid; no historical backfill is required.
