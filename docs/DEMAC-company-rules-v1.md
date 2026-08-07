# DEMAC Company Rules Registry — Version 1

This registry is the operational reference for the DEMAC ERP and WhatsApp Copilot. Runtime values that may change are stored in Firestore; protected behavior is implemented in code and tested.

## Source-of-truth hierarchy

1. `businessSettings/company-operational-rules` — editable capacity thresholds.
2. `businessSettings/appointment-work-presets` — editable appointment duration per AC unit.
3. `services` — current service prices and customer-facing service descriptions.
4. `whatsappKnowledgeRules` — approved customer answers and trigger examples.
5. Protected scheduling and communication rules — versioned code with automated tests.

The Chrome extension must not maintain a separate copy of prices, duration, capacity or policy.

## Operational rules

### OPS-SVC-001 — Standard service capacity at different properties

- A regular van day contains six one-hour standard-service slots.
- The morning contains three customer slots: 8:30, 9:30 and 10:30.
- The afternoon contains three customer slots: 13:30, 14:30 and 15:30.
- This represents a maximum of six different one-AC properties in one day, subject to route compatibility and staff availability.

### OPS-SVC-002 — Single-property seven-unit exception

- A single customer with up to seven standard-service AC units may receive one primary van for the full day.
- This exception is valid only with an 8:30 a.m. start.
- Seven AC units reserve the six visible ERP day slots as one full-day primary appointment.

### OPS-SVC-003 — Automatic support for eight to ten units

- For one property with eight, nine or ten standard-service AC units, the primary van is assigned up to seven units for the full day.
- A second van receives an internal support order for the remaining one, two or three units.
- The support order may occupy the morning or afternoon according to real availability and route efficiency.
- The primary order is created first and the support order references it as its parent.
- Above the configured automatic maximum, Operations must review the job manually.

### OPS-TEAM-001 — Real personnel assignment

- A van must have an available authorized driver.
- A staff member cannot belong to two vans on the same date.
- Saved daily assignments and absences override regular van assignments.
- Work requiring support must validate the personnel of every participating van before an option is offered and again before booking.

## Routing rules

### OPS-ROUTE-001 — Morning route anchor

- The first appointment at 8:30 a.m. establishes the primary morning sector for that van.
- The following morning appointments must be in the same sector, an adjacent compatible sector, or on the progressive route back toward the office.

### OPS-ROUTE-002 — Afternoon route anchor

- The first appointment at 1:30 p.m. establishes the afternoon sector.
- Later appointments must remain compatible with that anchor and move progressively toward the DEMAC office in Santa Cruz.

### OPS-ROUTE-003 — Availability before preference

- The customer is not asked to choose an unrestricted day and time.
- The ERP calculates real options from capacity, route, staff, closures and existing appointments.
- A time voluntarily supplied by the customer is treated as a mandatory restriction, not a scoring preference.

## Customer communication rules

### COMMS-001 — Do not expose internal van splitting

- For a large property, the customer is told that the team will start at 8:30 a.m. and that the work may continue throughout the day.
- The customer does not need to be told how many vans are assigned.

### COMMS-002 — One customer confirmation

- Only the primary work order sends appointment confirmation and reminder messages.
- Internal support orders never generate duplicate customer messages.

### COMMS-003 — Answer the current question first

- A direct question about duration, price, warranty, payment or service scope is answered before returning to appointment coordination.
- Confirmed facts such as address, quantity and time restriction remain in conversation memory.

### COMMS-004 — No invented information

- The AI classifies the customer message and selects an approved rule.
- Price, duration, descriptions and availability are read from the ERP.
- Missing or ambiguous information is transferred to Operations instead of being invented.

## Editable values in Settings → Company Rules

- Standard-service duration per AC unit.
- Deep-cleaning duration per AC unit.
- Standard-installation duration per AC unit.
- Special-installation duration per AC unit.
- Diagnostic / repair duration.
- Current prices from the service catalog.
- Main-van single-property capacity.
- Automatic support threshold and maximum.
- Support-van half-day capacity.
- Approved WhatsApp answers and trigger examples.

## Scenario acceptance test: ten standard-service units

Given:

- one property;
- ten standard-service AC units;
- at least two staffed vans;
- a free full day for the primary van;
- a free morning or afternoon block for the support van;

Then:

1. The customer receives available dates with an 8:30 a.m. start.
2. The reply says the work may continue throughout the day.
3. The reply does not mention a support van.
4. After customer confirmation, the ERP creates one primary full-day order for seven units.
5. The ERP creates one internal support order for three units in the best available half-day block.
6. Only the primary order contains customer notification recipients.
7. Both orders use the same client, property, address and parent-child booking relationship.
