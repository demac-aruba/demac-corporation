# DEMAC Company Rules Registry — Version 2

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
