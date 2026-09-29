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
- `OPS-PROJ-SCHED-001`: an active, provisioned Office Operator may schedule or place a
  Temporary Hold for an existing published Project, using its canonical Customer and
  Property and Booking Authority's atomic Appointment/Work Order/capacity/Project link.
  The operator may read only the scheduling projection needed for this work; creating,
  editing or completing Project planning and correcting historical Project capacity
  remain manager-only. Browser-local unpublished Projects cannot be booked by operators.
- `OPS-TASK-*`: internal operational tasks are independent of Scheduling, use canonical staff
  identity, governed lifecycle/version checks, private evidence and the existing WhatsApp authority.
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

## Current Task Tracker ownership

The rules below describe the ERP Next Task Tracker contract implemented on the feature branch.
Production activation remains separately owner-approved through the server-side activation boundary.

- `OPS-TASK-001` — `taskRecords` is the canonical internal operational Task record and
  append-only `taskEvents` is its audit/activity history. A Task is not an Appointment, Work Order,
  booking slot, scheduling hold, capacity reservation, or project phase. Creating, updating or
  completing a Task must never create, move, cancel, reserve or derive Scheduling & Dispatch work.
- `OPS-TASK-002` — A Task assignee references the existing canonical `staffProfiles` employee ID.
  Task Tracker must not create a second operator/employee directory. Historical name/phone snapshots
  may be retained on the Task for audit and messaging context, but current authorization resolves from
  the authenticated ERP user and its canonical `staffId` link.
- `OPS-TASK-003` — Task mutations are server-authoritative through authenticated Task Tracker
  functions. Super Admin, Operations and Project Manager roles may assign/administer Tasks. An Office
  Operator may execute only Tasks whose `assigneeStaffId` equals that operator's provisioned canonical
  `staffId`. Browser visibility or disabled controls are never authorization.
- `OPS-TASK-004` — Task writes use optimistic `version` checks and append audit events. `completed`
  and `cancelled` are terminal lifecycle states. `overdue` is a derived attention state based on the
  Aruba deadline and must not become a competing persisted lifecycle status. Completion may be blocked
  by an explicit checklist or evidence requirement.
- `OPS-TASK-005` — Task evidence is private operational evidence. Metadata belongs to the canonical
  Task while bytes live under the governed Firebase Storage `task-evidence/` namespace and are read or
  written only through the authenticated Task evidence authority. Evidence is never made public by URL;
  uploads are bounded to approved document/image types and 20 MB, version conflicts fail closed, and an
  uploaded object is cleaned up if its Task metadata transaction cannot commit.
- `OPS-TASK-006` — Task WhatsApp reminders reuse the existing canonical `whatsappOutboundQueue` and
  configured provider authority. They may send one configured daily digest per assignee plus deterministic
  24-hour, 3-hour, 1-hour, deadline and overdue reminders. Deterministic queue identifiers prevent repeat
  creation for the same reminder opportunity. Task Tracker must not create another WhatsApp sender,
  provider configuration, queue, contact model, or customer-conversation authority.
- `OPS-TASK-007` — Task persistence, evidence writes and reminder automation fail closed unless the
  server-side `businessSettings/task-tracker.backendEnabled` activation flag is explicitly enabled.
  That activation flag is intentionally absent from the normal Task Tracker UI. Production activation,
  Function deployment and any irreversible source-of-truth rollout remain within the Human Approval Boundary.

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

## Controlled manual transfer beyond ordinary capacity

- `OPS-SCHED-MOVE-OT-001` — An authorized office operator may explicitly accept possible
  overtime when manually transferring an existing, unexecuted, fixed-duration Appointment
  to another Van on the same nonhistorical appointment date. The destination must have a
  nonempty consecutive ordinary tail. Only the ordinary end boundary may be exceeded;
  the complete interval must still pass calendar, Van, staff and reservation validation.
  Booking Authority owns preparation and the atomic Appointment/Work Order/lock swap.
  Server-bound consent, actor/time/from/to audit and idempotent replay are mandatory.
  Cancellation of the confirmation writes nothing. Required slots and duration remain
  intact. The bounded estimate is not actual attendance or payroll overtime and adds no
  ordinary availability to automated booking or Maya. Multi-Van/support bookings retain
  their existing coordinated reschedule boundary.

## Current payroll-attendance ownership

- Payroll attendance periods are canonical 27th-through-26th ranges. The selected day is a
  child selection inside that range; selecting July 27 in the July 27–August 26 period does
  not change the payroll period to July.
- Normal scheduled attendance remains synthesized from the canonical employee schedule.
  Explicit `employeeTimesheets` records are created only for payroll-relevant exceptions.
- For a worked day, overtime is derived deterministically from the resolved schedule and
  actual Clock In, Clock Out, and Break Minutes. Early start, late finish, and unused
  scheduled break add independently after applying unused break to early departure as
  described below; overtime is not a manual payroll input.
- Late arrival, early departure, and break time beyond the scheduled break are independent
  missing-scheduled-time segments. Each segment must be explicitly classified as Paid or
  No Work No Pay and carry a reason before it can be saved.
- `OPS-STAFF-ATTENDANCE-BREAK-END`: after completing the scheduled regular worked
  minutes, unused scheduled break first covers an early departure. Only the remaining
  unused break becomes overtime and only the uncovered departure requires Paid/No Work
  No Pay classification. For 08:00–17:00 / 480 scheduled minutes, break 0 and departure at
  16:00 / 16:30 / 17:00 produce 0 / 30 / 60 overtime minutes and 480 regular minutes.
  This does not offset late arrival or missing time using early-start/late-finish overtime.
  Shifted breaks remain explicit attendance records even when payroll totals match normal
  attendance; retain actual Clock In/Out and Break Minutes, never a fictitious break.
- `OPS-STAFF-ATTENDANCE-PARTIAL-NO-WORK`: when fewer than the scheduled regular
  worked minutes were actually worked and the recorded break is shorter than the normal
  allowance, no unused lunch allowance is earned or applied to early departure. Calculate
  no-work minutes as scheduled worked minutes minus actual regular worked minutes; store
  one `partial_day` classification with no invented clock interval. Outside-shift overtime
  remains independent. This rule applies to every employee, using their resolved schedule.
  For 08:00–17:00 / 480 scheduled minutes, 13:00–16:00 with break 0 is 180 worked,
  300 no-work, zero unused break and zero overtime. Require an explicit Paid or No Work
  No Pay decision and reason. Paid permission contributes to paid-free hours (3 worked +
  5 paid no-work = 8 payable); unpaid contributes to NWNP (3 payable + 5 NWNP).
  Clock-deviation diagnostics are not the partial-day payroll absence total.
- All other overtime and missing scheduled time remain independent. Payroll retains both facts.
- Paid partial missing time contributes to paid-free time; unpaid partial missing time
  contributes to No Work No Pay. A partially affected employee can remain `Present`.
- New or edited explicit attendance records preserve an additive snapshot of the resolved
  scheduled start, end, break allowance, and scheduled paid-free minutes. Existing records
  without snapshot fields remain valid; no historical backfill is required.
- `CRM-LOCATION-001` (isolated preview): independent dwellings require explicit selection; stable Property-contained IDs and server membership checks preserve owner, contacts, equipment and visit scope. No apartment-count rule implies equipment count or automatic historical classification. See `decisions/ADR-20260921-property-dwellings.md`.

## Planned emergency and weekly-rest work

- `OPS-SCHED-PLANNED-OT-001` — Owner request 2026-09-29, effective with the approved release:
  an authenticated office scheduler may create an after-hours emergency for today or a future
  canonical open business date, starting at or after 17:00. Past dates remain rejected. The
  dated Van/crew and open-ended emergency guard remain authoritative.
- `OPS-SCHED-PLANNED-OT-002` — The same office scheduler may explicitly book a fixed workload
  in a Van's recurring weekly rest window. Preparation is read-only; confirmation binds the
  operator, request, dated crew/schedule, complete work selection and estimated finish. Three,
  four or more required slots are preserved through the same-date end, including a bounded
  extension after ordinary closing. All assigned crew must remain available; company closure,
  protected lunch, overlapping Van/staff work, midnight and stale consent still block commit.
  Only explicit office entry gets this exception; automated/ordinary availability is unchanged.
  Appointment/Work Order and canonical locks commit atomically and exact retries do not duplicate.
- Accepted weekly-rest work carries `scheduledOvertime` planning/audit metadata. It never writes
  actual attendance, payroll amounts or a different weekly schedule. Actual payable overtime
  continues to derive from real worked times against the employee's canonical schedule.
  Ordinary reschedule/move clears current planning metadata and keeps the original audit event.
- Owner: DEMAC Operations / Booking Authority. Source: Christian's Scheduling & Dispatch request
  2026-09-29. Migration: none; existing appointments, CRM and calendar records are not rewritten.

## New regular booking beyond afternoon capacity

- `OPS-SCHED-CREATE-OT-001` — Owner request 2026-09-29: an authenticated office operator may
  explicitly accept possible overtime when creating a fixed-workload Regular Booking in a Van's
  remaining ordinary afternoon tail. This extends the prior transfer-only exception to creation.
  Read-only preparation states required slots, available ordinary slots and estimated finish;
  confirmation binds actor, work, dated crew/schedule and exact request. Four services at 13:30
  preserve four slots through 17:30, with three ordinary slots. Three at 14:30 preserve three
  slots through 17:30, with two ordinary slots. Fitting work uses the ordinary booking route.
- Only the end of ordinary capacity may be exceeded. Existing reservations/holds, crew absence,
  unavailable Vans, company closure, weekly rest, protected lunch and midnight remain enforced.
  Canonical Appointment/Work Order/locks are atomic, replay is exact, and canceled consent writes
  no appointment. Explicit single-Van overtime never silently replaces a selected support booking.
- Persist `scheduledOvertime.kind = capacity_overflow_overtime` as accepted planning evidence,
  displayed as possible overtime. Ordinary/automated availability and actual payroll remain
  unchanged; elapsed real attendance determines payable overtime. No existing data migration.
