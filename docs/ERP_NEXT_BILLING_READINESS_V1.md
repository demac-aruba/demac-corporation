# ERP Next — Work Order → Billing Readiness V1

## Objective

Turn office-approved field work into an invoice-draft candidate without inventing prices and without creating a QuickBooks invoice automatically.

## Requirements

- BILL-001 — Only Office Review records with status `approved` create billing candidates.
- BILL-002 — Billing draft retains Work Order, Appointment, Review, Customer and Site identity.
- BILL-003 — Standard Service pricing can be calculated per exact HVAC asset when a governed BTU price exists.
- BILL-004 — Known Standard Service prices are: 9k = Afl. 100; 12k = Afl. 125; 18k = Afl. 135; 24k = Afl. 145; 36k = Afl. 175.
- BILL-005 — 220V switch add-ons use the governed sell price of Afl. 75 each.
- BILL-006 — Missing capacity, 60k Standard Service and work types without configured pricing remain `review_required`.
- BILL-007 — Brackets and armaflex remain review-required until governed sell-price rules are configured.
- BILL-008 — Refrigerant consumption is captured from field data, but exact billing remains review-required because DEMAC currently documents the sell price only as starting from Afl. 75.
- BILL-009 — ERP Next never guesses an unknown sell price to make a draft appear complete.
- BILL-010 — Known subtotal contains only governed priced lines.
- BILL-011 — Tax/accounting treatment, credits and discounts remain outside the preview calculation and are governed during accounting/QBO handoff.
- BILL-012 — A draft can be marked `ready_for_qbo` only when every billing line is governed/priced.
- BILL-013 — `ready_for_qbo` is a handoff state; it does not create or send a QuickBooks invoice by itself.
- BILL-014 — QuickBooks remains the current accounting system of record.

## Browser preview persistence

Storage key:

`demac.erp-next.finance.billing-drafts.v1`

## Pricing source hierarchy

1. accepted estimate / explicit commercial scope where applicable
2. governed ERP pricebook rule
3. approved manual pricing review
4. never infer/guess from unrelated historical values

## Production path

Approved Work Order
→ Billing Candidate
→ Pricing/Accounting Review
→ explicit QBO Sync
→ QBO Invoice ID returned
→ ERP invoice/payment/AR context

Future QBO integration must be idempotent using stable ERP billing/invoice identity so retries cannot create duplicate accounting documents.
