# ERP Next — CRM-Aware Scheduling Identity V1

## Objective

Remove duplicate customer/property entry from Scheduling by reusing the Customer 360 identity graph.

## Requirements

- SCHED-CRM-001 — Booking can select an existing CRM customer instead of retyping the customer name.
- SCHED-CRM-002 — Booking can select a registered Property/Site belonging to the selected customer.
- SCHED-CRM-003 — Appointment stores both internal `customerId` / `siteId` and display snapshots needed for the field workflow.
- SCHED-CRM-004 — Confirmed Work Order inherits `customerId` / `siteId` from the appointment.
- SCHED-CRM-005 — A registered site can suggest the DEMAC operating sector; an allowed customer area is the fallback.
- SCHED-CRM-006 — Manual customer/property entry remains available only as a fallback for a genuinely new or unregistered lead/property.
- SCHED-CRM-007 — Changing customer, site, sector, work type, quantity or restriction invalidates the previously selected scheduling option where applicable.
- SCHED-CRM-008 — The deterministic scheduling solver remains authoritative for offered capacity after identity selection.

## Current browser data source

The booking drawer reads the same browser-persistent CRM test graph used by Customer 360:

- customers: `demac.erp-next.crm.customers.v1`
- per-customer master data: `demac.erp-next.crm.master.{customerId}.v1`

No duplicate copy of customer/property data is created by the scheduling UI.

## Data handoff

Customer 360
→ Customer ID
→ Site ID
→ Appointment
→ Primary/support assignment
→ Work Order

The display name and site label remain as operational snapshots, but the internal IDs are preserved so future Firebase repositories can resolve the canonical relationship.

## Firebase replacement path

When Firebase CRM data mode is enabled, the selectors will read from the same repository contracts instead of browser storage. The booking/work-order information hierarchy does not change.
