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
- `OPS-VAN-PROFILE-*`: canonical Van ownership of regular crew, date-scoped override separation,
  optional third-helper semantics, Van profile lifecycle, and vehicle maintenance/repair history.
- `OPS-ROUTE-*`: route anchors and calculated availability precede customer preference.
- `OPS-SCHED-*`: historical work registration requires explicit operator acknowledgment,
  canonical conflict validation, audit markers and silent automatic communications.
- `OPS-STAFF-SCHEDULE-*`: employee schedule authority, employment-date boundaries, Van-aware
  technical schedule precedence, effective schedule versions, exact worked-hour windows, and Sunday closure.
- `OPS-STAFF-ATTENDANCE-*`: 27–26 payroll-period membership, schedule-derived overtime,
  separately classified partial missing-time segments, and explicit attendance schedule snapshots.
- `COMMS-*`: current-turn priority, answer-first behavior, natural language, contextual
  option selection, hidden internal van splitting, one confirmation, and no invention.

## Current Field portal ownership

- `FIELD-DAY-001` — A technician's Field route is limited to the current Aruba calendar day.
  The server derives that date; a technician-provided range cannot expose tomorrow or the week,
  a directly requested assigned Work Order from another date is unavailable, and every technician
  mutation rechecks that same date inside its transaction. A known Work Order or Work Visit ID from
  another date therefore cannot prepare, transition, or write Field truth. Governed Office
  review/history workflows remain separate and are not converted into technician execution access.
  This is a strict day boundary: after the Aruba calendar day changes, an earlier visit is read-only
  to the technician unless a later approved grace-window rule explicitly changes this policy.
- `FIELD-PREVIEW-001` — The temporary Super Admin Field preview may project today's canonical
  Scheduling data by individual Van or staff member during the explicitly owner-approved production
  UAT period that began on 2026-09-03. The surface remains restricted to an authenticated Super Admin,
  is enabled by default for this temporary validation period, and can be revoked immediately by setting
  the server-side `FIELD_ADMIN_SIMULATOR_ENABLED=false` deployment variable. Its interactive controls
  are browser-local simulation: they create no Work Visit, upload, draft, outbox item, audit event, or
  canonical mutation and never replace authenticated technician identity.

## Change protocol

Every rule change needs a stable ID, owner, source/evidence, effective date, affected
authorities, acceptance examples, regression tests, and migration impact. Configurable
values belong in governed settings; integrity and safety invariants remain protected code.
Ambiguity blocks automation and is escalated to an authorized human.

## Current Van profile ownership

- `OPS-VAN-PROFILE-001` — The canonical `vans` record owns the regular field crew: one
  responsible technician/driver, one regular helper, and an optional third helper. The same person
  cannot occupy two slots on the same Van or be regular crew on two Vans simultaneously.
  `staffProfiles.primaryVanId` is compatibility/read metadata only and must not become a second
  crew-assignment write authority.
- `OPS-VAN-PROFILE-002` — Temporary crew changes belong to `dailyVanAssignments` and apply only to
  their exact date. A dated override may contain a driver, helper, and optional additional helper.
  It never rewrites the regular Van crew, and the same employee may not resolve onto two Vans on the
  same date. Moving a person between Vans for one date requires the source Van's dated crew to be
  resolved as well.
- `OPS-VAN-PROFILE-003` — Technical recurring partial-day configuration belongs to
  `vanHalfDaySchedules` whenever the technical employee is part of a canonical regular Van crew;
  weekday plus exact Start/End are authoritative for worked time. Sunday remains governed by the
  company calendar and is not a Van partial-day choice.
- `OPS-VAN-PROFILE-004` — Vehicle maintenance and repair history remains in the existing
  `vanMaintenanceLogs` collection. Current odometer/service/insurance/registration milestones may
  also be projected on the canonical `vans` profile; no duplicate maintenance authority is created.
- Newly created Vans start `Fuera de servicio` so creating a profile cannot silently add live
  booking capacity before crew/status configuration is intentionally completed.
- Van WhatsApp group mapping continues through the existing governed Van schedule-group authority;
  the Vans screen is a UI for that same mapping rather than a second configuration source.

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
- A technical employee who is assigned to a canonical regular Van crew inherits the recurring
  schedule from that Van/team. `vanHalfDaySchedules` owns the exact Van partial-day Start and End;
  any existing individual employee schedule is preserved but must not override the active Van rule.
- A technical employee who is not assigned to any canonical Van may use the existing
  `employeePayrollSettings` authority for an effective individual schedule, including an exact
  recurring partial-day window. This does not create a new schedule collection or duplicate active
  authority.
- Assigning an unassigned technical employee to a Van immediately makes the Van/team schedule
  authoritative for Calendar, Attendance and Payroll. Removing the employee from all Vans makes the
  applicable preserved individual schedule active again. Moving the employee between Vans changes
  the inherited Van partial day automatically.
- The Employee Profile revalidates current canonical Van membership before saving an individual
  technical schedule. The domain write path defaults to rejecting technical individual schedules
  unless the caller explicitly confirms that no canonical Van currently owns the schedule.
- Effective employee schedule versions preserve historical schedule resolution instead of
  retroactively applying a later schedule change to earlier payroll/attendance dates.
- `employmentStartedAt` and `employmentEndedAt` bound synthesized schedule/attendance/payroll
  days: dates before the start or after the end resolve to zero scheduled hours; boundary
  dates themselves are inclusive.
- `staffAbsences` remains separate and represents dated vacation, sickness, or one-off
  unavailability; it never becomes a recurring partial-day rule.
- `dailyVanAssignments` is a date-scoped temporary crew assignment/override and does not
  redefine recurring schedule ownership.

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
