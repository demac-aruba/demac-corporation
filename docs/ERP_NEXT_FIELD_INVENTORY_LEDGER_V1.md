# ERP Next — Field → Inventory Ledger V1

## Objective

Make technician-recorded materials/add-ons flow into inventory as auditable job-consumption movements instead of requiring office staff to enter the same consumption again.

## Requirements

- INV-FIELD-001 — Submitted field execution can create inventory-consumption movements.
- INV-FIELD-002 — Movement source is the Work Order primary van/location.
- INV-FIELD-003 — Movement destination identifies the consuming Work Order.
- INV-FIELD-004 — Movement retains Work Order and Appointment identity.
- INV-FIELD-005 — 220V switches, brackets, armaflex and measured refrigerant are represented separately.
- INV-FIELD-006 — Refrigerant consumption uses measured units (`lb`) while discrete parts use `ea`.
- INV-FIELD-007 — Movement IDs are deterministic per Work Order/item type so refreshing/reprocessing does not create duplicate consumption.
- INV-FIELD-008 — Only technician executions already submitted to Office Review are eligible for consumption posting.
- INV-FIELD-009 — Inventory page shows the field-consumption ledger and its originating Work Orders.
- INV-FIELD-010 — Browser-preview movements do not alter production stock until the Firebase inventory transaction layer is activated.

## Current browser ledger

Storage key:

`demac.erp-next.inventory.movements.v1`

Movement type:

`job_consumption`

Source:

`field_execution`

## Production migration path

The same movement model will be written to the canonical `inventory_transactions` collection. Real van balances will be derived/materialized from the immutable transaction ledger rather than mutated ad hoc from field screens.

Future inventory posting will also support:

- general consumables/material lines beyond the first add-on set
- office correction/reversal movements
- serialized parts/equipment
- warranty/quarantine returns
- cross-van transfers
- real min/par/forecast updates after consumption
