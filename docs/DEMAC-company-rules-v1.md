# DEMAC Company Rules Registry — Version 4

This registry is the operational reference for the DEMAC ERP and WhatsApp Copilot. Runtime values that may change are stored in Firestore; protected behavior is implemented in versioned code and tested.

## Source-of-truth hierarchy

1. `businessSettings/company-operational-rules` — editable same-property capacity and support thresholds.
2. `businessSettings/company-service-pricing-rules` — editable BTU-specific prices and durations approved by DEMAC.
3. `businessSettings/appointment-work-presets` — general appointment duration defaults used by the agenda.
4. `services` — catalog descriptions and other service records not covered by the BTU-specific matrix.
5. `whatsappKnowledgeRules` — approved customer answers and multilingual trigger examples.
6. Protected scheduling, routing and communication rules — versioned code with automated tests.

The Chrome extension must not maintain a separate copy of prices, duration, capacity or policy.

## Commercial rules — split units

### PRICE-SVC-001 — Standard service

| Capacity | Price | Price type | Duration |
| --- | ---: | --- | ---: |
| 9,000 BTU | Afl. 100 | Special | 60 min |
| 12,000 BTU | Afl. 125 | Special | 60 min |
| 18,000 BTU | Afl. 135 | Special | 60 min |
| 24,000 BTU | Afl. 145 | Special | 60 min |
| 36,000 BTU | Afl. 175 | Regular | 60 min |

### PRICE-DEEP-001 — Deep cleaning

| Capacity | Price |
| --- | ---: |
| 9,000 BTU | Afl. 195 |
| 12,000 BTU | Afl. 195 |
| 18,000 BTU | Afl. 195 |
| 24,000 BTU | Afl. 195 |
| 36,000 BTU | Afl. 225 |

Deep-cleaning duration remains editable in Company Rules until a more specific operational matrix is approved.

### PRICE-INSTALL-001 — Standard installation for Adina purchased from DEMAC

| Capacity | Special installation price | Reserved duration |
| --- | ---: | ---: |
| 12,000 BTU | Afl. 200 | 120 min |
| 18,000 BTU | Afl. 225 | 120 min |
| 24,000 BTU | Afl. 250 | 120 min |
| 36,000 BTU | Afl. 300 | 180 min |

No 9,000 BTU installation price is defined in this rule because no approved value has been provided.

## Operational rules

### OPS-SVC-001 — Standard service capacity at different properties

- A regular van day contains six one-hour standard-service slots.
- The morning contains three customer slots: 8:30, 9:30 and 10:30.
- The afternoon contains three customer slots: 13:30, 14:30 and 15:30.
- This represents a maximum of six different one-AC properties in one day, subject to route compatibility and staff availability.
- The 3 + 3 structure is protected and is not edited like a commercial price.

### OPS-SVC-002 — Single-property seven-unit exception

- A single customer with up to seven standard-service split units may receive one primary van for the full day.
- This exception requires an 8:30 a.m. start.
- Seven units reserve the complete workday for that van.

### OPS-SVC-003 — Scalable support for a single property

- From eight standard-service units onward, the ERP may combine multiple staffed vans.
- Each full-day van can receive up to seven units and starts at 8:30 a.m.
- A remaining block of one to three units may use an available morning or afternoon support block.
- A remaining block of four to seven units requires another full-day van from 8:30 a.m.
- Example: 10 units = 7 + 3.
- Example: 14 units = 7 + 7.
- Example: 16 units = 7 + 7 + 2.
- `automaticSupportMaxUnits = 0` means there is no fixed numeric maximum; real capacity is limited by staffed vans, absences, existing work, route compatibility and closures.
- If a positive automatic maximum is configured, the Copilot must not exceed it automatically.

### OPS-TEAM-001 — Real personnel assignment

- A van must have an available authorized driver.
- A staff member cannot belong to two vans on the same date.
- Saved daily assignments and absences override regular van assignments.
- Work requiring support validates the personnel of every participating van before an option is offered and again before booking.

## Employee workforce schedule rules

### OPS-STAFF-SCHEDULE-001 — Effective individual employee work schedule

Owner: DEMAC owner/administrator. Updated effective rule: 2026-08-28.

- Office/non-technical employees may use the company schedule or an individual effective schedule stored in the existing `employeePayrollSettings` authority.
- A technical employee who is not assigned to any canonical Van may also use that same existing `employeePayrollSettings` authority for an individual effective schedule. This is not a new source of truth.
- The primary approved individual full-day templates are 08:00–17:00 with a one-hour break and 09:00–18:00 with a one-hour break.
- An individual full workday must contain exactly eight worked hours after the break.
- A recurring partial day is configured separately from the full-day shift and therefore is not subject to the eight-hour full-day validation.
- An individual schedule may have an `effectiveFrom` date and an optional `effectiveUntil` date.
- Later schedule versions must not retroactively replace the schedule used for earlier payroll, attendance or calendar dates.
- Migration impact: additive fields only; no production backfill or destructive migration is required.

### OPS-STAFF-SCHEDULE-002 — Office/non-technical recurring partial day

Owner: DEMAC owner/administrator. Corrected effective rule: 2026-08-27.

- The recurring partial day for office, administration and operator staff belongs to `employeePayrollSettings`.
- The partial-day weekday is employee-specific and may be Monday through Saturday.
- The administrator assigns the exact Start, End and optional Break for that employee's recurring partial day.
- Attendance, calendar and payroll schedule calculations count the resulting actual worked hours only.
- The system must not add, display or infer a synthetic "paid free" block for the unworked portion of a recurring partial day.
- Example: 09:00–13:00 with no break = 4 worked hours.
- Example: 09:00–14:00 with no break = 5 worked hours; the duration is not hard-coded to four hours.
- Legacy records that contain `halfDayWorkedHours`, `halfDayPaidFreeHours` or morning/afternoon placement metadata remain readable. Their stored metadata is not deleted, but recurring schedule resolution uses worked time only and does not count the legacy paid-free field as scheduled time.
- Explicit historical timesheet/payroll records are not rewritten by this correction.

### OPS-STAFF-SCHEDULE-003 — Technical recurring schedule authority

Owner: DEMAC owner/administrator. Updated effective rule: 2026-08-28.

- A technical employee assigned to a canonical regular Van crew inherits the recurring schedule from that Van/team. The Van's partial day belongs to `vanHalfDaySchedules`.
- The Van/team's exact `workdayStart` and `workdayEnd` determine the assigned technician's recurring partial-day worked hours.
- Only the actual worked window is counted; no synthetic paid-free hours are added.
- An individual employee schedule must never override or duplicate the active Van/team schedule while the technical employee is assigned to a Van.
- A technical employee with no canonical Van assignment may instead use the existing versioned `employeePayrollSettings` individual schedule, including an administrator-defined exact partial-day weekday, Start, End and optional Break.
- Assigning that employee to a Van immediately makes the Van/team schedule authoritative for Calendar, Attendance and Payroll without deleting the employee's saved individual schedule history.
- Moving the employee from one Van to another changes the inherited Van partial day automatically.
- Removing the employee from all canonical Vans makes the applicable preserved individual schedule authoritative and editable again.
- Before the supported Employee Profile flow saves an individual technical schedule, it rechecks current canonical Van membership. The schedule write contract rejects technical writes by default unless the caller explicitly confirms that the technician has no canonical Van assignment.

### OPS-STAFF-SCHEDULE-004 — Employment-date schedule boundary

Owner: DEMAC owner/administrator. Effective date: 2026-08-27.

- `employmentStartedAt` is the first date on which the ERP may synthesize scheduled work for an employee.
- Dates before `employmentStartedAt` resolve to zero scheduled hours when generating calendar, assumed attendance and payroll projections.
- If `employmentEndedAt` exists, dates after it resolve to zero scheduled hours.
- The employment start and end dates themselves are inclusive.
- Explicit historical records are preserved; this rule does not delete or rewrite existing timesheets, absences or payroll documents.

### OPS-STAFF-SCHEDULE-005 — Sunday company closure

Owner: DEMAC owner/administrator. Effective date: 2026-08-27.

- Sunday is globally company-closed.
- An individual employee schedule may not override Sunday closure.

## Employee payroll attendance rules

### OPS-STAFF-ATTENDANCE-001 — Canonical 27–26 payroll calendar

Owner: DEMAC owner/administrator. Effective date: 2026-08-27.

- A payroll period starts on the 27th of the previous calendar month and ends on the 26th of the payroll month.
- Payroll navigation moves exactly one canonical payroll period at a time. September payroll (Aug 27–Sep 26) moved one period backward becomes August payroll (Jul 27–Aug 26), not July payroll.
- The selected attendance date is subordinate to the active payroll period and does not redefine it.
- Selecting Jul 27 while viewing Jul 27–Aug 26 keeps the active payroll calendar as August payroll.
- Surrounding dates rendered only to complete a calendar week are contextual and must not silently create or edit records in another payroll period.

### OPS-STAFF-ATTENDANCE-002 — Schedule-derived overtime

Owner: DEMAC owner/administrator. Effective date: 2026-08-27.

- Overtime for a worked attendance day is derived from the employee's canonical resolved schedule plus actual Clock In, Clock Out and Break Minutes; it is not manually entered.
- Overtime minutes are the sum of work before the scheduled start, work after the scheduled end, and unused scheduled break minutes.
- Overtime is independent from missing scheduled time. A late arrival, early departure or extended break does not erase overtime worked elsewhere in the same day.
- Example for 09:00–18:00 with a 60-minute scheduled break: 09:00–18:00/60 = 0 OT; 08:00–18:00/60 = 60m; 09:00–18:30/60 = 30m; 08:00–18:30/60 = 90m; 09:00–18:00/30 = 30m; 09:00–18:00/0 = 60m.

### OPS-STAFF-ATTENDANCE-003 — Partial missing-time classification

Owner: DEMAC owner/administrator. Effective date: 2026-08-27.

- A worked day may contain separate missing-scheduled-time segments for late arrival, early departure and break time beyond the scheduled break allowance.
- Each detected segment must be classified independently as `Paid` or `No Work No Pay` and must contain a reason before the attendance exception can be saved.
- Different segments on the same date may use different treatments and reasons.
- Paid missing time contributes to payroll paid-free time; unpaid missing time contributes to No Work No Pay. Regular worked scheduled time remains separate.
- A partially affected employee may remain `Present`; partial exceptions do not force the entire day to `Absent`.
- Example: a 09:00–18:00 employee working 11:00–16:30 has a 09:00–11:00 late-arrival segment and a 16:30–18:00 early-departure segment. The two segments are classified separately.
- Example: a 60-minute scheduled break with 90 minutes taken creates a separate 30-minute extended-break segment.

### OPS-STAFF-ATTENDANCE-004 — Explicit attendance schedule snapshot

Owner: DEMAC owner/administrator. Effective date: 2026-08-27.

- When a payroll-relevant daily attendance exception is explicitly saved, the `employeeTimesheets` record preserves additive snapshot fields for the resolved scheduled start, scheduled end, scheduled break allowance and scheduled paid-free minutes used for that edit.
- Existing historical timesheet records without these snapshot fields remain valid and are not destructively backfilled.
- Canonical schedule version history remains the authority for synthesized historical days; the snapshot is audit evidence for the explicit attendance record, not a second schedule authority.

## Routing rules

### OPS-ROUTE-001 — Morning route anchor

- The first appointment at 8:30 a.m. establishes the primary morning sector for that van.
- Following morning appointments must be in the same sector, an adjacent compatible sector, or on the progressive route back toward the office.

### OPS-ROUTE-002 — Afternoon route anchor

- The first appointment at 1:30 p.m. establishes the afternoon sector.
- Later appointments must remain compatible with that anchor and move progressively toward the DEMAC office in Santa Cruz.

### OPS-ROUTE-003 — Availability before preference

- The customer is not asked to choose an unrestricted day and time once the ERP has enough information to calculate availability.
- The ERP calculates real options from capacity, route, staff, closures and existing appointments.
- A day or time voluntarily supplied by the customer is treated as a scheduling constraint.

## Conversation rules

### COMMS-001 — Current turn has priority

- The most recent customer turn determines the current intention.
- Conversation memory answers “what do we already know?”; it does not decide “what does the customer want now?”.
- A simple greeting receives a greeting even if an earlier turn discussed duration or price.
- A direct availability question is routed to appointment coordination rather than inheriting an earlier knowledge intent.

### COMMS-002 — Answer the current question first

- A direct question about duration, price, warranty, payment or service scope is answered before returning to appointment coordination.
- Confirmed facts such as address, quantity and time restriction remain available for the next step.

### COMMS-003 — Natural customer language

- Customer-facing text must not mention ERP configuration, prompts, models, databases or other internal implementation details.
- Simple questions receive simple answers.
- Multiple questions are separated into short paragraphs.
- The Copilot should ask no more than two short questions in one message when collecting missing information.

### COMMS-004 — Contextual option selection

- Appointment confirmations are interpreted against the options that were actually offered.
- Expressions such as “the first one”, “that time works”, or “a las 8 está bien” can select an offered 8:30 option when it is the only reasonable match.
- If more than one option remains genuinely plausible, the Copilot asks for clarification instead of guessing.

### COMMS-005 — Do not expose internal van splitting

- For a large property, the customer is told that the team will start at 8:30 a.m. and that the work may continue throughout the day.
- The customer does not need to be told how many vans are assigned.

### COMMS-006 — One customer confirmation

- Only the primary work order sends appointment confirmation and reminder messages.
- Internal support orders never generate duplicate customer messages.

### COMMS-007 — No invented information

- The AI classifies language and chooses the correct operational path.
- Price, duration, descriptions and availability come from approved ERP rules/data.
- Missing or ambiguous information is escalated or clarified instead of invented.

## Knowledge-rule priority

`priority` is only a tie-breaker between rules that already match the current customer question. A high-priority payment rule, for example, must never answer an unrelated greeting or availability request.

## Editable values in Settings → Company Rules

- BTU-specific standard-service prices and duration.
- BTU-specific deep-cleaning prices and duration.
- Adina-from-DEMAC standard-installation prices and duration.
- Main-van same-property capacity.
- Automatic support threshold.
- Optional automatic maximum (`0` = no fixed maximum).
- Half-day support capacity.
- Approved WhatsApp answers and multilingual trigger examples.

## Acceptance scenarios

### Employee schedule regression examples

- Existing office employee with legacy Wednesday partial-day metadata → Wednesday keeps its historical worked window, for example 08:00–12:00, and resolves to 4 worked hours with zero synthetic paid-free schedule hours.
- Office employee on a 09:00–18:00 schedule with one-hour break → a normal day resolves to 8 worked hours.
- Office employee on a 09:00–18:00 schedule with Wednesday exact partial day 09:00–13:00 and no break → Wednesday resolves to exactly 4 worked hours.
- Office employee configured for an exact partial day 09:00–14:00 and no break → that day resolves to exactly 5 worked hours, proving partial duration is administrator-defined rather than hard-coded.
- Employee whose employment starts on 2026-08-11 → 2026-08-10 resolves to zero synthesized scheduled hours; 2026-08-11 is included.
- Technical employee with no Van, individual 09:00–18:00 schedule and Wednesday 09:00–13:00 partial day → Wednesday resolves to 4 worked hours and Payroll receives 4 regular hours with zero synthetic paid-free time.
- That same technical employee assigned to a Van whose partial day is Thursday 08:00–13:00 → the saved individual Wednesday partial day becomes inactive; Thursday resolves from the Van to 5 worked hours.
- Moving that technician to another Van → the inherited partial day changes automatically to the new Van's rule.
- Removing that technician from all Vans → the applicable preserved individual schedule becomes active and editable again without a migration or recreated record.
- Technician assigned to a Van with Wednesday 08:00–13:00 partial day → Wednesday resolves to 5 worked hours with zero synthetic paid-free schedule hours even if an employee payroll record contains another schedule.
- Any employee custom schedule on Sunday → Sunday remains closed with zero scheduled hours.
- Saving a new schedule effective 2026-09-01 on an employee with a legacy schedule → dates before September continue resolving against the preserved legacy schedule version; explicit historical records are not deleted or rewritten.

### Employee payroll-attendance regression examples

- September payroll Aug 27–Sep 26 → Previous once = Jul 27–Aug 26; Previous again = Jun 27–Jul 26.
- While Jul 27–Aug 26 is active, selecting Jul 27 keeps August payroll active.
- 09:00–18:00/60 break → 0m overtime; 08:00–18:00/60 → 60m; 09:00–18:30/60 → 30m; 08:00–18:30/60 → 90m; 09:00–18:00/30 → 30m; 09:00–18:00/0 → 60m.
- Exact 09:00–13:00 recurring partial day with no break → 4 worked hours, 0 synthetic break and 0 overtime when worked as scheduled.
- 09:00–18:00 employee working 11:00–16:30 → two independent missing-time segments: 09:00–11:00 and 16:30–18:00. Saving is blocked until both have treatment and reason.
- 09:00–18:00 with a 90-minute break instead of 60 → 30-minute extended-break segment.
- A paid morning medical absence and an unpaid afternoon personal permission on the same day remain separate; overtime, if any, is retained independently.

### Ten standard-service units

Given one property, ten units and at least two compatible staffed vans:

1. The customer receives available dates with an 8:30 a.m. start for the primary work.
2. The reply says the work may continue throughout the day.
3. The reply does not mention a support van.
4. After confirmation, the ERP creates one primary full-day order for seven units.
5. The ERP creates one internal support order for three units in the best available half-day block.
6. Only the primary order sends customer notifications.

### Fourteen standard-service units

Given one property, fourteen units and at least two compatible staffed vans:

1. The ERP allocates seven units to each van.
2. Both vans reserve the full day from 8:30 a.m.
3. The customer still receives one appointment conversation and one confirmation.

### Conversation regression examples

- `Buenos días` → greet and ask how to help; do not answer an old duration question.
- `¿Tienes cupo para el martes?` → recognize the requested day and collect only missing service facts before checking the agenda.
- `¿Cuánto dura un servicio estándar?` → answer naturally: approximately one hour per AC unit; do not mention ERP configuration.
- After offering 8:30 and 9:30, `a las 8 está bien` → select 8:30 when that is the unique reasonable interpretation.
