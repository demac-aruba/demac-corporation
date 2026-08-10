# DEMAC ERP Next — Scheduling & Dispatch V1

Status: In Development / deterministic preview foundation.

## Purpose

Scheduling is an operational optimization problem, not a generic calendar. ERP Next must propose appointments from real DEMAC capacity, work duration, geography, vans, customer restrictions and job readiness.

## Requirements

### SCHED-001 — Four operational van resources
The dispatch board models four active vans/teams as capacity resources. Van/team configuration must eventually come from Settings rather than code.

### SCHED-002 — Configurable workday and service starts
Current DEMAC defaults are Mon–Fri 8:00–17:00, lunch 12:00–13:00, with ordinary service starts at 08:30, 09:30, 10:30, 13:30, 14:30 and 15:30. These are defaults, not immutable business rules.

### SCHED-003 — Customer cannot bypass capacity logic
The customer may communicate restrictions and preferences, but the ERP owns availability. A customer-facing agent or operator must offer only slots returned as valid by the scheduling engine.

### SCHED-004 — Customer restrictions are hard filters
Restrictions such as morning, afternoon, after 10:00 or after 14:00 remove invalid options before an offer is produced. Rejected or incompatible options are not repeated merely because they were offered earlier.

### SCHED-005 — AM and PM geographic anchors
The first valid job assigned to a van in the morning establishes the AM sector anchor; the first valid afternoon job establishes the PM anchor. Subsequent work should remain in the same, adjacent or route-compatible sector according to the configured Aruba sector graph.

### SCHED-006 — Route-to-office context
DEMAC’s Santa Cruz office is the routing reference for return/transition logic. Geographic scoring will later use verified GAC/geocodes; V1 uses explicit operating-sector compatibility rather than invented distance facts.

### SCHED-007 — Configurable work presets
Scheduling duration comes from configured work presets: standard service, deep cleaning, diagnostic, repair, standard/extended/rooftop/second-floor/third-floor installation, anti-corrosive treatment and Other. The values in V1 are baseline defaults and must become Settings-managed before production cutover.

### SCHED-008 — Customer description and technician instructions are separate
Appointment creation produces a customer-facing description independently from internal technician instructions. Technician-only notes are never included automatically in customer confirmations/reminders.

### SCHED-009 — Temporary hold before final confirmation
A selected option first becomes a temporary hold/reservation state. Final booking confirmation is a controlled state transition after the required checks/transaction complete.

### SCHED-010 — Linked support van
Large same-site work can create a primary assignment plus a linked support-van assignment. The support assignment inherits customer, property and work context rather than creating a second customer appointment.

### SCHED-011 — One customer communication owner
Only the primary appointment/assignment owns confirmation and reminder communications. A support van must never generate duplicate confirmation/reminder messages to the customer.

### SCHED-012 — Standard-service same-site capacity
The current operational baseline allows more same-site service capacity than separate-property service because transit is removed. The exact per-van same-site maximum remains configuration-driven; the current baseline keeps 7 as the single-van ceiling and 6 units per van when a linked two-van support plan is used.

### SCHED-013 — 10-unit support example
A 10-unit same-site standard-service job can be represented as a linked 6 + 4 assignment across two vans, while preserving one customer appointment and one customer communication owner.

### SCHED-014 — Job readiness gate
Readiness evaluates crew, skill, van, route, tools, parts/equipment, customer confirmation, deposit/PO/commercial clearance and access. Statuses are READY, AT RISK or BLOCKED.

### SCHED-015 — No invented availability
If duration, route, capacity or customer restrictions leave no valid option, the system returns no valid capacity and asks for another day/restriction rather than inventing a time.

### SCHED-016 — Scheduling is provider-neutral
The scheduling engine consumes canonical jobs/resources/settings and does not depend directly on Firebase document shapes or WhatsApp conversation state.

## V1 preview implementation

- Dedicated `/scheduling` premium route.
- Four-van dispatch board with AM/PM anchor visibility.
- Live readiness coloring and temporary-hold state.
- Booking Intelligence rail, readiness example, support-van rule and unscheduled queue.
- Premium appointment drawer with customer/site/sector, work preset, unit quantity, restriction, customer-facing description and technician instructions.
- Deterministic candidate-slot engine for ordinary work.
- Deterministic two-van full-day support plan for large standard-service jobs when two vans are available.
- Temporary hold can be added to the in-memory dispatch board.

## Next Scheduling checkpoints

1. Continuous same-site capacity planner for 4–7 standard services that correctly spans lunch without modeling customer transit.
2. Multi-day/week resource calendar and date-specific job storage.
3. Settings-backed work duration and shift configuration.
4. Official GAC/geocoder adapter and DEMAC operating-sector mapping.
5. Skill/crew availability and technician absence integration.
6. Inventory/tool/job-readiness adapter.
7. Booking state persistence and concurrency protection.
8. Firebase adapter plus migration mapping from Legacy appointments.
9. Acceptance tests covering customer restrictions, anchor routing, holds and support vans.

## Deferred decisions

- final Aruba sector adjacency matrix after GAC/geocode validation
- exact same-site capacity overrides by work type/team composition
- Saturday scheduling rules in the first ERP Next production release
- route scoring weights and travel-time provider
