# ERP Next — Purchasing Readiness V1

## Objective

Convert uncovered replenishment needs into structured internal Purchase Requirements without inventing suppliers, prices, taxes, payment terms or Purchase Orders.

## Requirements

- PUR-REQ-001 — Purchase need is derived only after safe internal replenishment capacity has been exhausted.
- PUR-REQ-002 — Uncovered needs are aggregated by item across multiple van destinations.
- PUR-REQ-003 — Purchase Requirement retains item, unit, requested quantity, demand locations, priority and operational reason.
- PUR-REQ-004 — Multiple van needs for the same item can become one Purchase Requirement while preserving destination demand detail.
- PUR-REQ-005 — An open Purchase Requirement prevents duplicate requirements for the same item.
- PUR-REQ-006 — Requirement lifecycle begins `open → reviewed → approved_for_sourcing`.
- PUR-REQ-007 — `approved_for_sourcing` does not mean ordered and does not create a Purchase Order.
- PUR-REQ-008 — Supplier, unit cost, taxes, freight and payment terms remain unknown until supported by a quote, pricebook or other approved evidence.
- PUR-REQ-009 — ERP Next must never calculate a purchase value from guessed historical or unrelated prices.
- PUR-REQ-010 — Open/reviewed requirements can be cancelled before sourcing approval.
- PUR-REQ-011 — Approved-for-sourcing requirements require a governed closure/reversal path rather than silent cancellation.
- PUR-REQ-012 — Purchase Requirement is an internal demand record, not an accounting transaction or inventory receipt.
- PUR-REQ-013 — Creating/reviewing/approving a requirement does not change inventory balances.
- PUR-REQ-014 — Future PO workflow must explicitly select supplier/commercial terms and approval authority before creating a financial commitment.

## Demand flow

Van balance/readiness
→ internal replenishment analysis
→ safe transfer suggestions
→ uncovered quantity
→ aggregate by item
→ Purchase Requirement
→ review
→ approved for sourcing
→ future supplier quote / Purchase Order workflow

## Data truth boundary

Operational truth currently known:

- item
- quantity required
- where the demand exists
- priority
- why internal stock cannot cover it

Commercial truth not yet known:

- supplier
- unit cost
- currency
- taxes
- freight
- lead time
- payment terms

Those fields remain blank instead of being inferred.

## Browser persistence

`demac.erp-next.purchasing.requirements.v1`

## Production migration

Recommended production hierarchy:

Purchase Requirement
→ Supplier Quote(s)
→ approved sourcing decision
→ Purchase Order
→ Goods Receipt / Inventory Transaction
→ Supplier Bill / QBO sync
→ Bank reconciliation

Each transition should retain explicit actor, timestamp, source document and audit correlation.