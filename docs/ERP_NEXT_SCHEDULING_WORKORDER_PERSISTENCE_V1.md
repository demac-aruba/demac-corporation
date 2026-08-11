# ERP Next — Scheduling → Work Order Persistence V1

## Objective

Make the approved DEMAC scheduling engine testable as a real operational flow without changing its routing/capacity rules.

## Scheduling persistence

- SCHED-PERSIST-001 — Test appointments created in Scheduling survive browser refresh on the current device.
- SCHED-PERSIST-002 — The appointment remains the parent record for one primary van and an optional support van.
- SCHED-PERSIST-003 — Temporary hold and confirmed are explicit appointment states.
- SCHED-PERSIST-004 — Support assignments remain linked to the primary appointment and never become a second customer appointment.
- SCHED-PERSIST-005 — The primary assignment remains the single customer communication owner.
- SCHED-PERSIST-006 — Persisting an appointment does not replace or bypass the existing deterministic capacity/sector solver.

## Appointment → Work Order handoff

- WO-HANDOFF-001 — Confirming a temporary hold creates one linked Work Order automatically.
- WO-HANDOFF-002 — Customer, site, sector, work type, quantity, schedule and technician instructions are inherited rather than re-entered.
- WO-HANDOFF-003 — Primary/support van assignments are inherited by the Work Order.
- WO-HANDOFF-004 — The support assignment has `customerCommunicationOwner = false`.
- WO-HANDOFF-005 — Confirming the same appointment again cannot create a duplicate browser Work Order.
- WO-HANDOFF-006 — Work Order readiness is derived from the persisted assignment readiness state.
- WO-HANDOFF-007 — Work Orders page exposes the handoff evidence so the relationship between Appointment and Work Order is visible.

## Current persistence mode

These records use the namespaced browser preview store:

- `demac.erp-next.operations.appointments.v1`
- `demac.erp-next.operations.work-orders.v1`

This is transitional test persistence only:

- local to one browser/device
- no multi-user synchronization
- clearing site data removes test records
- no production audit trail yet

The same information hierarchy will move behind the Firebase repository contracts after the CRM identity graph and Security Rules are activated.

## Next checkpoint

Replace manual customer/property text entry in the booking drawer with the existing CRM identity graph:

Customer → Property/Site → sector → registered equipment.

Manual fallback remains available only for an unregistered/new lead until the customer record is created.
