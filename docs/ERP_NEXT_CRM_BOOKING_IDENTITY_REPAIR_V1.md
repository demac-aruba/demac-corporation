# ERP Next — CRM Booking Identity Repair V1

## Objective

Restore the intended canonical identity chain from Customer 360 into Scheduling and Work Orders after CI exposed that the live branch had retained the downstream screens but lost the CRM-aware booking selector.

## Requirements

- CRM-BOOK-001 — Scheduling loads existing browser-persistent CRM customers.
- CRM-BOOK-002 — Selecting an existing customer scopes the Property/Site selector to that customer.
- CRM-BOOK-003 — Registered Customer ID and Site ID are stored on the Appointment.
- CRM-BOOK-004 — Customer ID and Site ID survive Appointment → Work Order conversion.
- CRM-BOOK-005 — Registered property/customer sector may suggest the DEMAC operating sector.
- CRM-BOOK-006 — Manual customer/property entry remains only as a fallback for a genuinely new/unregistered lead or property.
- CRM-BOOK-007 — Changing Customer, Property or Sector invalidates a previously selected candidate slot where appropriate.
- CRM-BOOK-008 — The deterministic Scheduling solver remains authoritative after CRM identity selection.
- CRM-BOOK-009 — Support-van assignments remain children of one customer appointment and do not create a second customer communication owner.
- CRM-BOOK-010 — Work Order creation is idempotent by Appointment ID.
- CRM-BOOK-011 — Downstream exact HVAC scope, Field Execution, Customer Timeline and Finance projections can resolve the durable CRM identity.

## Repaired dependency chain

Customer 360 browser identity
→ Customer ID
→ Property/Site ID
→ Appointment
→ Work Order
→ exact HVAC asset scope
→ Field Execution / Customer Timeline / Billing context

## Production migration

The browser selectors will later read from the Firebase CRM repository adapter instead of localStorage. The Appointment/Work Order contracts already preserve durable IDs so the downstream workflow does not need to be redesigned during that migration.