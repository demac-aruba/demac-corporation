# ERP Next — Scheduling Live Validation & Automatic Support V1

## Objective

Make booking failures understandable at the moment the operator creates them, while enforcing DEMAC same-property capacity and linked-support rules without requiring the operator to manually engineer van assignments.

## Requirements

- SCHED-VAL-001 — A disabled booking action is never the only explanation for a known scheduling rejection.
- SCHED-VAL-002 — When a visual work spot was clicked, the booking drawer evaluates that exact van/start against the current request live.
- SCHED-VAL-003 — A half-day anchor conflict is shown beside Customer & Property as soon as customer/property/sector are known.
- SCHED-VAL-004 — Route errors identify the selected van, AM/PM anchor sector, requested sector and selected work spot.
- SCHED-VAL-005 — Customer time-restriction conflicts are shown before final booking.
- SCHED-VAL-006 — Duration/window conflicts explain when the requested work cannot fit while protecting lunch, route margin and return buffer.
- SCHED-VAL-007 — Van overlap/capacity conflicts are surfaced rather than hidden behind an empty options list.
- SCHED-VAL-008 — `Number of A/C units` is an editable text state while typing; the operator may delete `1` and enter a replacement number without the UI forcing `1` back into the field.
- SCHED-VAL-009 — Empty/invalid quantity prevents capacity calculation and shows an immediate quantity error.
- SCHED-VAL-010 — Current browser booking supports 1–14 Standard Service units for the two-van same-property planning model.
- SCHED-SUP-001 — A single van may receive up to 7 Standard Service units at one property.
- SCHED-SUP-002 — From unit 8 onward, the booking engine requires linked support and does not offer a silent single-van plan.
- SCHED-SUP-003 — 8–10 units plan 7 on the primary full-day van and 1–3 on a compatible AM or PM support block when possible.
- SCHED-SUP-004 — 11–14 units plan 7 on the primary van and 4–7 on a second linked full-day van.
- SCHED-SUP-005 — The support van is selected by the deterministic scheduler; the operator selects the valid combined plan rather than manually assigning support.
- SCHED-SUP-006 — Support assignment keeps its own start/end/segment from Appointment through Work Order and Dispatch.
- SCHED-SUP-007 — Support assignment never becomes a second customer appointment and never owns duplicate confirmation/reminder communication.
- SCHED-SUP-008 — If linked support is required but unavailable, the operator sees an explicit `Support van required but unavailable` error.
- SCHED-SUP-009 — Valid option cards show the linked support van and its actual support time window.

## Example — route rejection

Given:

- Van 1 AM anchor = Noord
- operator clicked Van 1 at 10:30 AM
- selected customer property sector = San Nicolas

Expected live result:

`Route conflict for this work spot` appears under Customer & Property and explains that Van 1's morning anchor is Noord and San Nicolas is outside the compatible morning route for the selected 10:30 spot.

The operator may choose another valid ERP option; the system does not silently enable the incompatible spot.

## Example — quantity editing

The field initially contains `1`.

The operator can select/delete it, leaving the field temporarily blank, then type `8`. The ERP does not transform this into `18` and does not force `1` back during typing.

## Example — 10 A/C units

A Standard Service request for 10 units at one property is planned as:

- Primary van: 7 units, full-day 8:30 start
- Support van: 3 units in an available route-compatible AM or PM block
- One Customer / Property / Appointment
- One customer communication owner

## Acceptance coverage

The existing `test:dispatch` simulation now additionally verifies:

1. Noord AM anchor + San Nicolas preferred 10:30 spot produces a property-level route error.
2. 10 units produces a linked 7 + 3 support plan with explicit support timing.
3. 14 units produces a linked 7 + 7 full-day plan.

## Current data mode

Browser-persistent ERP Next test data. No Firebase, QBO, bank or WhatsApp production writes are introduced by this checkpoint.
