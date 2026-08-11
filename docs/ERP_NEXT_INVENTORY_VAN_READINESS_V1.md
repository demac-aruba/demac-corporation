# ERP Next — Inventory Balance & Van Readiness V1

## Objective

Treat the office warehouse and each DEMAC van as inventory locations whose current balance is derived from transactions rather than edited directly.

## Requirements

- INV-BAL-001 — Main Warehouse and Van 1–4 are distinct stock locations.
- INV-BAL-002 — Current stock is a derived value, not an independently editable truth field.
- INV-BAL-003 — Browser preview starts from an explicit opening-balance snapshot and subtracts posted job-consumption movements.
- INV-BAL-004 — Submitted Field Execution add-ons are synchronized into the inventory ledger using stable Work Order/item movement IDs.
- INV-BAL-005 — Re-reading/re-syncing Field Execution cannot duplicate an already-posted Work Order/item consumption movement.
- INV-BAL-006 — Each tracked location/item can define minimum, par and target quantities.
- INV-BAL-007 — Restock-to-par is calculated as `max(0, par - current)`.
- INV-BAL-008 — Van stock readiness is `READY` when all configured lines are at/above minimum.
- INV-BAL-009 — Van stock readiness is `AT RISK` when one or more lines fall below minimum but no essential configured line is empty.
- INV-BAL-010 — Van stock readiness is `BLOCKED` only when an explicitly configured essential line reaches zero.
- INV-BAL-011 — Van stock readiness is not allowed to masquerade as Work Order readiness.
- INV-BAL-012 — A Work Order can only be blocked for material shortage when explicit required materials/parts are known for that Work Order.
- INV-BAL-013 — Tools/assets remain a separate custody model and are not merged into consumable quantity balances.
- INV-BAL-014 — Browser opening balances are test seeds, not production inventory truth.
- INV-BAL-015 — Future receipts, transfers, returns and adjustments must post ledger transactions; they must not write arbitrary current balances.

## Current derivation

For this checkpoint:

`Current = Opening Balance − Submitted Job Consumption`

The production equation expands to:

`Current = Opening + Receipts + Inbound Transfers + Job Returns − Outbound Transfers − Job Consumption ± Approved Adjustments`

## Field integration

Field Execution
→ submitted Work Order
→ technician add-ons/material consumption
→ deterministic `job_consumption` movement IDs
→ inventory ledger
→ location balance projection
→ van stock health / replenishment signal

## Current preview item scope

The browser readiness projection initially tracks the first operational lines already represented in the Field workflow:

- 220V Switch
- Refrigerant
- A/C Bracket
- Armaflex / Insulation

This is deliberately not the final Item Master. Variants, units of measure and additional consumables must be governed in the canonical Inventory Item Master before production activation.

## Production migration

Recommended Firebase model:

- `inventory_items`
- `inventory_locations`
- `inventory_policies` (minimum/par/target per item/location)
- append-oriented `inventory_transactions`
- optional materialized balance/readiness projections for speed

Balance corrections should be represented as approved adjustment/cycle-count transactions with actor, reason and audit evidence rather than overwriting historical ledger truth.