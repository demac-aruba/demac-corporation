# ERP Next — Inventory Transfer Ledger V1

## Objective

Represent Office ↔ Van and Van ↔ Van replenishment as governed custody transactions rather than direct stock balance edits.

## Requirements

- INV-TR-001 — Transfer is a parent business record with source location, destination location and one or more item lines.
- INV-TR-002 — Source and destination cannot be the same inventory location.
- INV-TR-003 — Transfer lifecycle is `requested → approved → issued → received` with cancellation allowed before issue.
- INV-TR-004 — Requesting or approving a transfer does not move stock.
- INV-TR-005 — Issuing a transfer posts deterministic `transfer_out` movement(s) and removes quantity from source on-hand.
- INV-TR-006 — Issued stock is considered in transit and is not yet part of destination on-hand.
- INV-TR-007 — Receiving a transfer posts deterministic `transfer_in` movement(s) and adds quantity to destination on-hand.
- INV-TR-008 — Source stock is revalidated immediately before issue; a transfer cannot issue more than current derived source balance.
- INV-TR-009 — Stable movement IDs prevent retry/reload from duplicating transfer-out or transfer-in quantity.
- INV-TR-010 — Transfer retains requester, approver, issuer, receiver and their event timestamps.
- INV-TR-011 — Cancellation after issue is prohibited; a physically issued error requires a return/reversal transaction rather than history deletion.
- INV-TR-012 — Current location balance includes transfer-in and transfer-out movements alongside field job consumption.
- INV-TR-013 — Inventory transfer actions do not directly overwrite current balance.
- INV-TR-014 — Production serialized equipment/tools/high-value transfers may add stricter approval/scan requirements without changing the parent custody model.

## Ledger effect

Requested:

`no quantity movement`

Approved:

`no quantity movement`

Issued:

`source → IN TRANSIT`

Received:

`IN TRANSIT → destination`

## Current balance projection

For the browser checkpoint:

`Current = Opening + Transfer In − Transfer Out − Job Consumption`

This means a transfer can temporarily reduce total on-hand across tracked physical locations while stock is physically in transit. That is intentional; in-transit custody is a separate operational state.

## Browser persistence

Transfer records:

`demac.erp-next.inventory.transfers.v1`

Movement ledger:

`demac.erp-next.inventory.movements.v1`

## Production migration

Firebase should preserve:

- transfer parent record
- transfer lines
- custody status/timestamps
- authenticated requester/approver/issuer/receiver IDs
- deterministic/transaction-safe inventory ledger entries
- audit correlation ID

For production, issue/receive must execute atomically with the corresponding inventory transaction write so transfer status and ledger truth cannot diverge.