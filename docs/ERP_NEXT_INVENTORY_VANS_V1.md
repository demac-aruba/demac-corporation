# DEMAC ERP Next — Inventory & Van Stock V1

Status: In Development / preview and domain foundation.

## Purpose

Treat physical inventory as a location-controlled operational ledger. The main warehouse, every van, quarantine/warranty locations and future job-site staging are explicit inventory locations. Technicians are accountable for custody, but quantity ownership belongs to the location.

## Requirements

### INV-001 — Every van is a mobile warehouse
Van 1 through Van 4 are inventory locations with their own stock balances, reservations, min/par/target levels and movement history.

### INV-002 — Inventory classes are explicit
The item master distinguishes consumables, measured consumables, sellable parts, serialized parts, HVAC equipment, company tools, PPE and warranty/quarantine stock.

### INV-003 — Quantity and asset tracking are separate
Measured/quantity inventory uses stock balances. Serialized equipment and tools can additionally require serial/asset identity and custody history.

### INV-004 — Stock availability accounts for reservations
Available stock is `on hand − reserved`. Job reservations must reduce what can be promised to another Work Order even before physical consumption occurs.

### INV-005 — Transfers are auditable custody workflows
Office↔van and van↔van transfers record source, destination, requester, approver when required, issuer, receiver, date/time and quantity. Stock is not treated as magically moved because someone typed a note.

### INV-006 — High-value transfers require stronger control
Serialized parts, HVAC equipment and company tools require an approval/custody path beyond a normal low-value consumable transfer.

### INV-007 — Van min/par/target stock is configurable
Each van/item can define minimum, par and target levels. Service, installation, commercial/VRF and diagnostics van templates can later provide default profiles.

### INV-008 — Tools are separate company assets
Vacuum pumps, drills, manifolds, recovery machines, micron gauges and similar tools have asset tag/serial, condition, location, custodian and calibration/service context. Tool custody does not behave like consuming a roll of tape.

### INV-009 — Work Order material use becomes inventory consumption
Structured material usage recorded in Field Operations later drives reservation/consumption/return transactions. Technicians should not re-enter the same usage in an inventory screen.

### INV-010 — Add-ons can affect inventory and finance
Accepted/installed switches, brackets, drain pumps, refrigerant and similar add-ons can create inventory consumption plus invoice/margin/commission inputs through downstream adapters.

### INV-011 — Job readiness checks van stock
A Work Order can be READY, AT RISK or BLOCKED based on whether required material/equipment is available on the assigned van/location.

### INV-012 — Projected availability is explainable
The planning formula is:

`Projected available = on hand + inbound purchase + inbound transfers − reserved jobs − expected consumption`

Recommendations must expose these inputs rather than returning an opaque AI number.

### INV-013 — Purchasing recommendations target configured stock
When projected availability falls below minimum, the engine can recommend replenishment toward the configured target. A recommendation is not an automatic purchase order.

### INV-014 — Cycle counts and adjustments remain auditable
Future cycle counts record counted quantity, expected quantity, variance and reason. Inventory corrections are explicit adjustment transactions rather than silent balance edits.

### INV-015 — Warranty/quarantine stock is isolated
Returned, suspect, warranty or quarantined items remain visible but are not treated as normal available inventory until released through a controlled state transition.

### INV-016 — Inventory UI is provider-neutral
Inventory domain logic does not depend on Firebase document shapes. Persistence and authorization are adapters around canonical item/location/movement/transfer records.

## V1 preview implementation

- Dedicated `/inventory` premium command center.
- Stock tab with location rail for main warehouse, four vans and quarantine.
- Location stock balances with on-hand, reserved, available, minimum and par levels.
- Vans tab with mobile-warehouse health and below-minimum items.
- Transfers tab with requested → approved → issued → in transit → received custody states.
- New-transfer drawer with source/destination/item/quantity and high-value approval signal.
- Tools tab with company tool asset tag, serial, condition, location, custodian placeholder and calibration date.
- Forecast tab implementing projected-availability and recommended-purchase formulas.
- Job readiness example showing Van 2 shortages against known job requirements.
- Inventory Intelligence rail explaining transfer/replenishment recommendations.

## Next Inventory checkpoints

1. Real item master create/edit/classification workflow.
2. Per-van min/par templates and replenishment recommendations.
3. Work Order reservation/consumption/return adapter.
4. Cycle count and variance workflow.
5. Serialized HVAC equipment receiving/allocation.
6. Tool checkout/return/damage/lost/calibration workflow.
7. Purchase Order and supplier receiving foundation.
8. Warehouse↔van / van↔van transaction posting with concurrency protection.
9. Firebase persistence/security and Legacy stock migration mapping.
10. Acceptance tests for reservations, transfers, field consumption and no-negative-stock policies.

## Deferred decisions

- final negative-stock policy and emergency manager override
- exact van-stock templates by team specialization
- which consumables are worth tracking versus treated as overhead
- final supplier lead-time/reorder calculation
- barcode/QR scanning format for inventory and tools
