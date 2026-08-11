# ERP Next — Inventory Replenishment Intelligence V1

## Objective

Detect van stock below par and recommend a safe internal replenishment or purchasing escalation without automatically moving inventory.

## Requirements

- INV-REPL-001 — Replenishment evaluates each Van 1–4 item against its configured par level.
- INV-REPL-002 — Open requested/approved/issued inbound transfers count as planned incoming so ERP does not propose duplicate replenishment.
- INV-REPL-003 — Open requested/approved outbound transfers count as source commitments when calculating safe donor surplus.
- INV-REPL-004 — Main Warehouse is the preferred internal replenishment source when it can supply stock without falling below its own minimum.
- INV-REPL-005 — Van-to-van replenishment is only suggested when the donor van has quantity above its own par after existing commitments.
- INV-REPL-006 — Suggested transfer quantity moves the destination toward par, not blindly to target.
- INV-REPL-007 — If internal safe surplus cannot cover the need, the uncovered quantity is marked `purchase_required`.
- INV-REPL-008 — Critical priority is reserved for an effectively empty essential van-readiness line.
- INV-REPL-009 — Warning priority represents below-minimum stock; routine priority represents below-par but still healthy stock.
- INV-REPL-010 — Replenishment suggestions are projections, not inventory transactions.
- INV-REPL-011 — `Prepare Transfer Request` creates a transfer in status `requested` only.
- INV-REPL-012 — Replenishment intelligence cannot approve, issue or receive stock automatically.
- INV-REPL-013 — Donor allocation is conservative across multiple destinations so the same safe surplus is not promised twice inside one recommendation pass.
- INV-REPL-014 — Purchase-required recommendations do not invent a supplier, purchase price or purchase order.

## Decision hierarchy

1. Consider current balance plus already-planned inbound transfers at the destination.
2. Determine deficit to par.
3. Try Main Warehouse while preserving its minimum and existing commitments.
4. If still needed, try donor vans only from surplus above donor par.
5. If still uncovered, emit Purchase Required for the remainder.

## Automation boundary

The intelligence layer may:

- detect shortage risk
- recommend source/destination/item/quantity
- prepare a transfer request after an operator clicks the action

The intelligence layer may **not**:

- approve the transfer
- issue stock
- confirm receipt
- overwrite a balance
- create a purchase order without a governed purchasing workflow

## Production migration

Firebase-backed replenishment should read authoritative materialized balances / inventory transactions and open transfer commitments inside a transactionally consistent snapshot. Suggestions should carry calculation time/data freshness and may later include booked Work Order consumption, supplier lead time and seasonality.