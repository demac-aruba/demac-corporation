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
- `OPS-SCHED-SUPPORT-001`: coworker support with one or more consecutive available slots may be added to current/future confirmed
  appointments and, with explicit historical acknowledgement, past confirmed/completed work.
  Default to one slot; stop at occupied capacity, a clock gap/lunch or the shift end.
  Revalidate and atomically lock every selected slot; never override another reservation.
  Preserve the primary assignment/status, transactional capacity/crew controls and audit.
  Historical support is non-billable, suppresses automatic messages and does not alter payroll/Field actuals.
- `OPS-SCHED-*`: historical work registration requires explicit operator acknowledgment,
  canonical conflict validation, audit markers and silent automatic communications.
- `OPS-SCHED-REFERENCES-001`: owner Christian's 2026-10-05 request, effective upon approved
  release: any booking may optionally carry office/customer reference photos, videos,
  voice files, per-file explanations, notes and GPS. Office may add or edit them after
  creation. Booking Authority retains canonical Appointment ownership; these references
  are not technician completion evidence, financial authorization or workload changes.
  The existing 08:00 Aruba WhatsApp schedule sends each Work Order followed by its own
  ordered files before the next work message. Photos/videos carry their explanation;
  voice explanations immediately precede the voice message. Transient retries retain
  that ordering; a terminal failed file remains pending for explicit office retry
  without blocking later jobs or future schedules. Same-day edits after 08:00
  queue a separately identified update to current assigned Vans. Historical writes,
  future edits and Temporary Holds remain silent until otherwise eligible.
  Owner: Operations / Booking and Communication Authorities. Migration: none.
  Regression: bookingVisitReferences, bookingVisitReferencesHttp, whatsappReferenceBundle,
  technicianDailyScheduleService and vanScheduleCommunicationAuthority tests.
- `OPS-PROJ-SCHED-001`: an active, provisioned Office Operator may schedule or place a
  Temporary Hold for an existing published Project, using its canonical Customer and
  Property and Booking Authority's atomic Appointment/Work Order/capacity/Project link.
  The operator may read only the scheduling projection needed for this work; creating,
  editing or completing Project planning and correcting historical Project capacity
  remain manager-only. Browser-local unpublished Projects cannot be booked by operators.
- `OPS-SCHED-PROJECT-BACKDATE-001`: owner request 2026-10-05, effective on approved
  release: existing Project schedulers may register previously unscheduled work for
  a published, schedulable Project at an elapsed time today or on a previous date,
  on any eligible Van. Booking Authority requires explicit historical acknowledgement,
  revalidates canonical capacity/crew/calendar, Project version and CRM/phase links,
  and commits Appointment/Work Order/locks/Project link atomically with actor/time audit.
  Automatic messages and historical Temporary Holds remain disabled. This registration
  does not confer Project planning permissions or the manager-only adjustment/recovery
  of an existing historical booking, and writes no Field/payroll/financial actuals.
  Owner: Operations / Booking Authority. Migration: none.
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

- `OPS-SCHED-MOVE-REST-001` — Owner request 2026-10-03, effective on approved
  release: an authenticated office operator may move an unexecuted confirmed,
  fixed-duration, single-Van appointment into a recurring weekly-rest window on
  the same nonhistorical date, including within its current Van. All eligible
  Vans use the same rule. An explicit rest/overtime confirmation binds the actor,
  source, dated crew/schedule and complete destination estimate. Preparation or
  cancellation writes nothing. Booking Authority atomically preserves identity,
  workload, links and full capacity, swaps locks and records acceptance in the
  existing move audit. Company closure, staff absence, work/hold overlap, lunch,
  morning rest crossing the regular shift, midnight and stale consent still block.
  Four slots moved to 13:30 remain four slots until 17:30. Ordinary availability,
  recurring schedules and actual payroll remain unchanged; no migration required.
  Existing ordinary overflow transfers retain OPS-SCHED-MOVE-OT-001.

## Current payroll-attendance ownership

- `OPS-STAFF-BONUS-MANUAL`: authorized payroll users enter approved employee bonuses
  manually by employee, date and 27–26 payroll period, with category, positive Afl. amount
  (at most two decimals), concept/reason and actor/time audit. Categories describe the
  input; they do not award automatic attendance bonuses or calculate sales commission rates.
  Existing `employeePayrollSettings.payrollAdjustments` entries remain authoritative,
  including Legacy records; active bonuses are included in Employees and Finance PDF/CSV
  exports. Cancellations retain the original entry and a reason, and exclude its amount
  from totals. Bonuses never change attendance hours or offset salary advances automatically.
  Ambiguous identity/history blocks exports instead of silently reporting a zero amount.

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
- `OPS-SCHED-PLANNED-OT-PROJECT` — Owner request 2026-10-01: weekly-rest Book Overtime
  also supports existing published Projects for every eligible Van/date. The operator selects
  the Project, its phase when applicable and whole Van slots, acknowledges an exceeded Project
  budget when applicable, then explicitly confirms overtime. Booking Authority reuses the
  canonical Project permission/version/CRM checks and atomically commits its Project link with
  the Appointment, Work Order and locks. Project identity/version is bound to consent and exact
  replay never duplicates the link. Open-ended emergency and ordinary overflow Project entry
  are outside this change. Existing calendar, crew, lunch, overlap and midnight guards apply.
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

## Appointment projections, final amounts and receipts

- `OPS-SCHED-CHARGES-001` — Owner request and deployment authorization 2026-10-10.
  Preserve the original projection, separately record current projection/final amount,
  and record actual office-reported receipts by cash, transfer, POS or SUAVE against
  the canonical appointment. Owner clarification 2026-10-12: new or changed concepts
  resolve the selected actual service/product and exact BTU through canonical tariffs.
  Operators cannot directly override a line price or describe one matrix service as another.
  Existing snapshot unit prices and labels, including historical manual agreements, are retained
  while service/BTU/work-line identity remains unchanged; quantity changes use that unit price.
- Owner clarification 2026-10-13: actual-work entry selects existing catalog articles as
  invoice-style lines. A capacity-specific service selection already identifies its specifications;
  operators do not reconfigure that article or reconfirm BTU. Final pricing resolves capacity from
  a recognized canonical capacity-specific booking code when needed, never from a name/SKU.
  Quantity and explicit removal remain available; the next catalog search stays below the list.
  Owner clarification 2026-10-13: each actual-work article has an optional editable description,
  initialized from catalog metadata, stored with the confirmed line/history and included in the
  operational PDF. Description edits cannot change tariffs or article identity. Final confirmation
  and correction require scope review but no separate reason textarea; dated actor history remains.
  Estimate corrections and receipt voids retain their existing reason requirements.
  Owner clarification 2026-10-13: Importes y pagos opens directly on that catalog row,
  without "Registrar trabajos realizados" or "Usar trabajos agendados" choices. The
  first actual line begins the work draft; planned/forecast lines are never copied into
  it. Existing confirmed work remains explicitly editable with its agreed snapshots.
  Existing agreed snapshots are preserved before applying today's catalog definitions. A generic
  article without enough pricing information remains pending; select a specific configured article.
- Unknown prices remain pending; explicit zero requires a configured zero tariff (or an existing
  historical snapshot). Opening an old appointment never backfills missing financial values.
  Final scope review permits an outstanding balance and never marks Field/attendance complete.
- Opening Importes y pagos reserves its appointment for one active financial writer/session,
  with a server-owned 90-second renewable lease. Other operators read with the holder name;
  closing/changing the appointment or principal, lost permission and blockers release the
  lease; expiry recovers disconnects. After the first finance visit, internal Resumen /
  Importes / Historial navigation retains the same session and mounted invoice inputs
  (owner-requested performance correction, 2026-10-19). Prefetch and history-only visits
  never acquire. New writes require ownership plus expected version inside the transaction.
  A freshly authorized exact retry of an already committed operation remains resolvable after expiry.
- Split payments, immutable receipt identity, exact replay, expected-version conflicts,
  dated actor audit and reasoned voids are mandatory. Voids do not execute refunds.
- Existing financial records are not imported or overwritten. Field candidate evidence
  requires explicit fingerprint-bound reconciliation before final confirmation and is not
  automatically summed again. No live migration or new client-write permission is needed.

- `OPS-SCHED-CHARGES-002` — Owner clarification 2026-10-12: new bookings automatically
  snapshot the selected work at canonical minimum tariffs when BTU is unknown. These
  minimums are forecast-only; final service pricing uses the selected catalog specification
  (automatically resolving canonical BTU when required). Actual services,
  products and quantities are explicitly reviewed separately from planned work. Old
  originals/agreements remain preserved, and missing historical projections are not backfilled.
  Receipt entry alongside an actual-work draft preserves it only across the same session's
  verified write; external version changes still require review. See
  `adrs/automatic-booking-projection-20261013.md` for compatibility and rollback constraints.

- Owner-approved 2026-10-13 workspace clarification: the original/current projection is
  informational only. Estimated balance during entry uses the current valid actual-work
  quote minus saved receipts; confirmed balance uses only the saved final minus receipts.
  Missing/invalid totals remain pending. During background validation, current draft quantities may preview server-returned unit prices; confirmation still requires the exact current authority quote and a fresh scope acknowledgment (2026-10-14 owner optimization). Drafts never mark a visit paid. A local PDF may
  export freshly read, reconciled confirmed work and receipts as an operational summary;
  it does not issue an official invoice or write to QBO. See
  `adrs/appointment-charge-balance-pdf-20261013.md`.
- Actual-work form recovery is private, versioned and scoped to the authenticated user,
  appointment and browser tab. Refresh/reopen restores inputs, requotes them and resets
  scope/Field acknowledgments. It never confirms a financial total. A lease-only version
  increase may rebase an equivalent full financial baseline; changed work, receipts or
  Field evidence require a new baseline-bound review before continuing.
- Monetary requests are retained before dispatch with their exact immutable identity.
  An uncertain request survives refresh/auth revalidation and is not replaced by a new
  request. Explicit sign-out clears ordinary drafts but preserves uncertain/unreadable
  copies for the same user's authorized reconciliation. See
  `adrs/appointment-charge-draft-recovery-20261013.md` for proven no-commit fencing.

- Owner-approved receipt UX clarification (2026-10-19): appointment payments open directly
  with amount, reference, one cash/transfer/POS/SUAVE selector and editable current Aruba
  date (without manual time selection, owner clarification 2026-10-20). The note is optional and collapsed. Displaying the empty form is not an edit;
  the first input captures its financial version. Registration remains one explicit,
  authority-confirmed operation; uncertain retries retain the exact original payload.

- Owner-approved payment corrections (2026-10-20): office-recorded, unallocated operational
  receipts may be corrected through the same Office authority, retaining receipt identity,
  original creator/time and count. Require a reason and append paymentBefore/paymentAfter
  snapshots with server actor/time. Adjust received balance by the amount delta atomically
  with the receipt and appointment version. Linked/reconciled/inconsistent receipts remain
  blocked. Date-only entry carries explicit Aruba business day plus compatible receivedAt;
  registration/correction timestamps remain independent and server-owned. Existing timestamps
  are preserved if their day is unchanged. No automatic repair/backfill of historical receipts.

## Booking Spots and workload support

- `OPS-SCHED-SPOTS-001` — Effective 2026-10-10, owner-requested Scheduling rule: display service workload as Spots using the existing canonical duration and capacity policy. Live remaining capacity is a dated Van snapshot; only Booking Authority can confirm it. An overloaded mixed/manual booking reuses selected helper windows or explicit possible-overtime consent. Primary Work Order owns customer service quantities exactly once; marked helpers are nonbillable operational support and do not inherit the full planned Field scope. Preserve the existing Standard full-day exception and Project policy. Morning capacity overflow skips protected lunch, keeps exact minute estimates, and never creates payroll actuals. No migration of existing records. Acceptance and tests: `tasks/booking-spots-capacity-20261010.md` and `functions/bookingSpotsIndependentReview.test.js`.

## QuickBooks sandbox reporting

- `FIN-QBO-SANDBOX-READ-001` — Owner-requested 2026-10-12. Active ERP owners/admins may
  manually read three allowlisted reports from the configured test company through
  the existing QuickBooks boundary. QuickBooks owns values, currency, basis and totals.
  The ERP must not silently truncate, infer zero values, cache official balances, or
  write accounting transactions. Token rotation must be serialized, encrypted and
  recoverable through reauthorization after uncertain outcomes. Real DEMAC accounting
  access, financial synchronization and ChatGPT/MCP access remain separate stages.

## Catalog maintenance candidate (2026-10-12)

- `OPS-CATALOG-001` — Existing services/products remain canonical. Empty price is unpriced, explicit zero is free; customer/Inventory/reservation consumers must preserve that distinction.
- Catalog writers preserve a frozen observed version; stale edits fail with the draft retained. Fresh current role and exact replay are server-enforced. Existing unknown fields and creation metadata survive updates.
- Booking-code uniqueness follows actual legacy booking resolution. Delete retains private audit/identity and rejects linked work, Field interventions/sales or stock. Deleted IDs cannot be reused.
- No bulk rewrite/backfill is implied. Direct-write closure requires verified backend, ERP, Legacy and old-session cutover plus forward recovery. See the finance governance task/review.

## QuickBooks production reporting

- `FIN-QBO-CATALOG-READ-001` — Owner-only reads deployed 2026-10-14;
  live owner-session acceptance pending. The designated active owner may explicitly compare
  ERP customers/articles against a bounded QBO Customer/Item/Account page. Matching
  names, email or SKU suggest review only. Inactive records remain visible; missing
  matches in a partial page never authorize creation. This read stage introduces no persistent mapping or
  accounting/inventory write. Persistent identity confirmation is governed separately below. See `adrs/quickbooks-catalog-20261014.md`.

- `FIN-QBO-PRODUCTION-READ-001` — Owner authorized continuation on 2026-10-13 after
  confirming DEMAC realm 9130352327074466 (CompanyInfo country AW). Only the designated
  owner with a currently active administrative profile may request four fixed reports:
  ProfitAndLoss, BalanceSheet, AgedReceivables and AgedPayables. Official amounts, currency,
  basis and dates come from QuickBooks, with no inferred balances or persisted report values.
  The report function shares the existing authorization operation lease, retains rotated
  credentials encrypted, and fails closed on uncertain refresh or identity changes. No
  accounting writes, synchronization, financial export to AI, or MCP access is authorized
  by this reporting release. See `adrs/quickbooks-production-reports-20261013.md`.


## QuickBooks explicitly confirmed identities (2026-10-19)

- `FIN-QBO-LINKS-001` — The designated active owner may prepare and explicitly confirm
  existing Customer/Item identities for fixed production realm `9130352327074466`.
  Suggestions never save automatically. The server re-reads canonical ERP identity and
  the selected fixed provider page, compares observation fingerprints and holds a private
  intent for five minutes. Confirmation revalidates owner, connection, ERP source and
  mapping version; it never issues a provider accounting write.
- One active ERP identity per provider identity, scoped by entity and company/environment.
  Concurrent claims conflict; retries reuse the same version. Another target requires
  explicit revocation, preserving versioned history and both underlying records.
- Inactive records, subcustomer/project hierarchies and incompatible service/product types
  are blocked. A changed/deleted source, changed connection, or changed provider observation
  is review-required. Currency, taxation, accounts, units, prices and inventory treatment
  are not approved by identity confirmation; future sends must validate them separately.
- No invoice, payment, customer/item creation, inventory movement, historical import or
  synchronization is authorized. Expired intent metadata remains private; no destructive
  cleanup or TTL policy is introduced. See `adrs/quickbooks-confirmed-links-20261019.md`.
